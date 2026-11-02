import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { DeployRecord, EnvVar } from '@flightdeck/protocol';
import { bearer, tokenOk } from './auth.js';
import type { Context } from './context.js';
import { deployFromWorkflowRun, verifySignature } from './github.js';
import {
  identityEnabled,
  legacyPermissions,
  permissionsFor,
  verifyToken,
  type Permission,
  type Principal,
} from './identity.js';
import { logger } from './logger.js';

const log = logger.child({ component: 'http' });

/** Resolved caller identity and permissions for one request. */
interface AuthState {
  principal?: Principal;
  perms: Set<Permission>;
}

type AppEnv = { Variables: { auth: AuthState } };

/** Fixed placeholder shown in place of a secret env value. Hides the length too. */
const ENV_MASK = '********';

/** Replace every env value with the mask, keeping the keys visible. */
function maskEnv(env: EnvVar[]): EnvVar[] {
  return env.map((e) => ({ key: e.key, value: ENV_MASK }));
}

/**
 * REST surface for the web UI, the GitHub webhook, and a Prometheus metrics
 * endpoint. Live log streaming is over WebSocket, not here.
 */
export function createHttpApp(ctx: Context, agentCount: () => number): Hono<AppEnv> {
  const { config, store, audit, metrics, deploys } = ctx;
  const app = new Hono<AppEnv>();
  const idEnabled = identityEnabled(config);

  // Metrics are unauthenticated (counts only, no secrets) and outside /api so
  // the CORS and dashboard-token middleware below do not apply.
  app.get('/metrics', (c) =>
    c.text(metrics.render({ agents: agentCount(), services: store.listServices().length })),
  );

  // Liveness and readiness probes, unauthenticated and outside /api so a
  // container orchestrator can reach them without a token (the /api surface is
  // gated, so a probe there would fail once auth is on). They expose no secrets.
  //   /healthz - liveness: the process is up and serving.
  //   /readyz  - readiness: dependencies (the deploy store) are responsive.
  app.get('/healthz', (c) => c.json({ status: 'ok', version: '0.1.0' }));
  app.get('/readyz', (c) => {
    try {
      // A trivial query proves the SQLite handle is open and responsive.
      deploys.list(undefined, 1);
    } catch {
      return c.json({ status: 'not ready' }, 503);
    }
    return c.json({ status: 'ready', agents: agentCount(), services: store.listServices().length });
  });

  // GitHub webhook: authenticated by HMAC signature, not the dashboard token,
  // so it lives outside /api. Disabled unless a secret is configured.
  app.post('/github/webhook', async (c) => {
    if (!config.githubWebhookSecret) return c.json({ error: 'webhook disabled' }, 404);
    const body = await c.req.text();
    if (!verifySignature(config.githubWebhookSecret, body, c.req.header('x-hub-signature-256'))) {
      return c.json({ error: 'bad signature' }, 401);
    }
    const event = c.req.header('x-github-event');
    if (event === 'workflow_run') {
      let deploy: DeployRecord | null;
      try {
        deploy = deployFromWorkflowRun(JSON.parse(body));
      } catch {
        return c.json({ error: 'invalid payload' }, 400);
      }
      if (deploy) correlateDeploy(ctx, deploy);
    }
    return c.json({ ok: true });
  });

  app.use('/api/*', cors({ origin: config.corsOrigin }));

  // Authenticate every /api request and resolve its permissions. With identity
  // on, a valid JWT is required; otherwise the legacy dashboard token applies
  // (and when neither is set, the API is open and the caller holds all perms).
  app.use('/api/*', async (c, next) => {
    if (c.req.method === 'OPTIONS') return next();
    const token = bearer(c.req.header('authorization'));
    if (idEnabled) {
      const principal = verifyToken(token, config, ctx.jwks);
      if (!principal) return c.json({ error: 'unauthorized' }, 401);
      c.set('auth', {
        principal,
        perms: permissionsFor(principal, config.operatorRoles, config.adminRoles),
      });
    } else {
      if (config.dashboardToken && !tokenOk(config.dashboardToken, token)) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      c.set('auth', { perms: legacyPermissions() });
    }
    return next();
  });

  app.get('/api/health', (c) => c.json({ ok: true, version: '0.1.0' }));

  // Who the caller is and what they may do, so the UI can show the user and
  // enable or hide the controls their role allows.
  app.get('/api/me', (c) => {
    const auth = c.get('auth');
    return c.json({
      identityEnabled: idEnabled,
      subject: auth.principal?.subject,
      name: auth.principal?.name,
      roles: auth.principal?.roles ?? [],
      permissions: [...auth.perms],
    });
  });

  app.get('/api/services', (c) => c.json({ services: store.listServices() }));

  app.get('/api/services/:id', (c) => {
    const id = c.req.param('id');
    const service = store.getService(id);
    if (!service) {
      return c.json({ error: 'not_found' }, 404);
    }
    const deploy = service.repo
      ? deploys.latestForRepo(service.repo, service.environment)
      : undefined;
    // Env values are secrets: mask them unless the caller has the reveal
    // permission. Keys stay visible either way so the UI can list what is set.
    const rawEnv = store.getEnv(id);
    const env = rawEnv ? (c.get('auth').perms.has('reveal') ? rawEnv : maskEnv(rawEnv)) : undefined;
    return c.json({ service, logs: store.recentLogs(id), deploy, env });
  });

  app.get('/api/deploys', (c) => {
    const repo = c.req.query('repo') || undefined;
    const limit = Number(c.req.query('limit'));
    return c.json({
      deploys: deploys.list(repo, Number.isFinite(limit) && limit > 0 ? limit : undefined),
    });
  });

  app.get('/api/audit', (c) => {
    const limit = Number(c.req.query('limit'));
    return c.json({ audit: audit.list(Number.isFinite(limit) && limit > 0 ? limit : undefined) });
  });

  return app;
}

/** Store a deploy and push it to the subscribers of every matching service. */
function correlateDeploy(ctx: Context, deploy: DeployRecord): void {
  ctx.deploys.record(deploy);
  ctx.metrics.incDeploy(deploy.status);
  let matched = 0;
  for (const svc of ctx.store.listServices()) {
    if (svc.repo && svc.repo === deploy.repo) {
      ctx.store.pushToService(svc.id, { type: 'deploy', serviceId: svc.id, deploy });
      matched += 1;
    }
  }
  log.info(
    { repo: deploy.repo, status: deploy.status, sha: deploy.sha.slice(0, 7), services: matched },
    'deploy recorded',
  );
}
