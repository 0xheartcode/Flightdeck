import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { DeployRecord } from '@flightdeck/protocol';
import { bearer, tokenOk } from './auth.js';
import type { Context } from './context.js';
import { deployFromWorkflowRun, verifySignature } from './github.js';
import { logger } from './logger.js';

const log = logger.child({ component: 'http' });

/**
 * REST surface for the web UI, the GitHub webhook, and a Prometheus metrics
 * endpoint. Live log streaming is over WebSocket, not here.
 */
export function createHttpApp(ctx: Context, agentCount: () => number): Hono {
  const { config, store, audit, metrics, deploys } = ctx;
  const app = new Hono();

  // Metrics are unauthenticated (counts only, no secrets) and outside /api so
  // the CORS and dashboard-token middleware below do not apply.
  app.get('/metrics', (c) =>
    c.text(metrics.render({ agents: agentCount(), services: store.listServices().length })),
  );

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

  if (config.dashboardToken) {
    app.use('/api/*', async (c, next) => {
      if (c.req.method === 'OPTIONS') return next();
      if (!tokenOk(config.dashboardToken, bearer(c.req.header('authorization')))) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      return next();
    });
  }

  app.get('/api/health', (c) => c.json({ ok: true, version: '0.1.0' }));

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
    return c.json({ service, logs: store.recentLogs(id), deploy });
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
