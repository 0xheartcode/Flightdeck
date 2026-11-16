import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { serve } from '@hono/node-server';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Config } from './config.js';
import type { Context } from './context.js';
import { logger } from './logger.js';
import { bearer } from './auth.js';
import { authorizeUpgrade } from './authorize.js';
import { JwksCache, logIdentityConfig, verifyToken } from './identity.js';
import { LokiClient, lokiEnabled } from './loki.js';
import { createBus } from './bus.js';
import { sessionToken } from './oidclogin.js';
import { CredentialStore } from './credentials.js';
import { CommandBus } from './commands.js';
import { AuditLog } from './audit.js';
import { createDeployStore } from './deploys.js';
import { Metrics } from './metrics.js';
import { Store } from './store.js';
import { createHttpApp } from './http.js';
import { TransmitterStore } from './transmitter/store.js';
import { TransmitterService } from './transmitter/service.js';
import { AgentTokenStore } from './agent-tokens/store.js';
import { UserStore } from './users/store.js';
import { MIN_PASSWORD_LENGTH } from './users/types.js';
import { readLocalSession } from './users/session.js';
import type { Principal } from './identity.js';
import { handleAgentConnection } from './agent-hub.js';
import { handleClientConnection } from './client-hub.js';

const REVOCATION_INTERVAL_MS = 15_000;
const REASONS: Record<number, string> = {
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  503: 'Service Unavailable',
};

export interface ControlPlaneHandle {
  /** Resolves with the bound port once the server is listening. */
  listening: Promise<number>;
  close: () => Promise<void>;
}

/**
 * The connecting peer's address, for the exposure view's host public IP. Uses
 * the real TCP peer by default; honours `X-Forwarded-For` only when the control
 * plane is explicitly configured to trust a reverse proxy, since the header is
 * otherwise client-spoofable.
 */
function peerAddress(req: IncomingMessage, config: Config): string | undefined {
  if (config.trustProxyHeaders) {
    const xff = req.headers['x-forwarded-for'];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? undefined;
}

/** Build and start the control plane. Returns a handle for tests and shutdown. */
export function startControlPlane(config: Config): ControlPlaneHandle {
  const log = logger.child({ component: 'control-plane' });

  const credentials = new CredentialStore(config);
  const deploys = createDeployStore(config);
  // Track a provider's rotating RS256 keys when a JWKS URI is set; the cache
  // refreshes in the background so verification stays synchronous.
  const jwks = config.oidcJwksUri ? new JwksCache(config.oidcJwksUri) : undefined;
  const stopJwks = jwks?.start();
  // Ship logs to Loki for durable storage and search, when configured.
  const loki = lokiEnabled(config) ? new LokiClient(config.lokiUrl, config.lokiTenant) : undefined;
  const stopLoki = loki?.start();
  // Inter-instance fan-out bus for HA (no-op unless a database is configured).
  const bus = createBus(config);
  const commands = new CommandBus(config.actionTimeoutMs);
  commands.setBus(bus);
  const audit = new AuditLog(config.auditMax, config.auditFile || undefined);
  // The Transmitter notifications hub (store + dispatcher), when enabled.
  let transmitterCtx: Context['transmitter'];
  if (config.transmitterEnabled) {
    const txStore = new TransmitterStore(config.transmitterDbFile);
    transmitterCtx = { store: txStore, service: new TransmitterService(txStore, audit) };
  }
  // Managed agent credentials (issue/rotate/revoke via the API), when enabled.
  const agentTokens = config.agentTokenStoreEnabled
    ? new AgentTokenStore(config.agentTokensDbFile)
    : undefined;
  // Local, self-managed user accounts (username/password auth), when enabled.
  let users: UserStore | undefined;
  if (config.localUsersEnabled) {
    users = new UserStore(config.localUsersDbFile);
    seedBootstrapAdmin(users, config.bootstrapAdmin, log);
  }
  // Agent authentication consults the static credential store first, then any
  // managed tokens, so both sources work side by side.
  const verifyAgentToken = (token: string | undefined): string | null =>
    credentials.verify(token) ?? agentTokens?.verify(token) ?? null;

  const ctx: Context = {
    config,
    store: new Store(config.logBufferSize, config.maxServices),
    commands,
    audit,
    metrics: new Metrics(),
    deploys,
    jwks,
    loki,
    bus,
    transmitter: transmitterCtx,
    users,
    agentTokens,
  };

  // Apply events from other instances to the local store (and thus to local
  // browsers), and route cross-instance commands. These never re-publish, so
  // there is no loop.
  bus.onMessage((msg) => {
    switch (msg.kind) {
      case 'service':
        ctx.store.upsertService(msg.service);
        break;
      case 'service_gone':
        ctx.store.removeService(msg.serviceId);
        break;
      case 'status':
        ctx.store.setStatus(msg.serviceId, msg.state, msg.exitCode, msg.ts);
        break;
      case 'log':
        ctx.store.appendLog(msg.log);
        break;
      case 'stats':
        ctx.store.setStats(msg.stats);
        break;
      case 'deploy':
        ctx.store.pushToService(msg.serviceId, {
          type: 'deploy',
          serviceId: msg.serviceId,
          deploy: msg.deploy,
        });
        break;
      case 'command':
        ctx.commands.handleBusCommand(msg);
        break;
      case 'command_result':
        ctx.commands.resolve(msg.id, msg.ok, msg.error);
        break;
    }
  });
  bus.start();

  log.info(
    { credentials: credentials.size, actions: config.actionsEnabled },
    'control plane starting',
  );
  logIdentityConfig(config);

  const agentWss = new WebSocketServer({ noServer: true, maxPayload: config.maxPayloadBytes });
  const clientWss = new WebSocketServer({ noServer: true, maxPayload: config.maxPayloadBytes });

  // Live agent connections with the token they presented, so a revoked
  // credential can have its connection dropped.
  const liveAgents = new Map<WebSocket, string>();

  // Total open WebSocket connections (agents + browsers), for the cap.
  let connections = 0;
  const track = (ws: WebSocket): void => {
    connections += 1;
    ws.on('close', () => {
      connections -= 1;
    });
  };
  const rejectUpgrade = (socket: Duplex, status: number): void => {
    socket.write(`HTTP/1.1 ${status} ${REASONS[status] ?? 'Bad Request'}\r\n\r\n`);
    socket.destroy();
  };

  const app = createHttpApp(ctx, () => liveAgents.size);

  let resolvePort!: (port: number) => void;
  const listening = new Promise<number>((resolve) => {
    resolvePort = resolve;
  });

  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    log.info(
      { host: config.host, port: info.port },
      'listening (agents: /agent, browser: /stream)',
    );
    resolvePort(info.port);
  });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const { pathname, searchParams } = new URL(req.url ?? '', 'http://localhost');
    const headerToken = bearer(req.headers.authorization);

    // Resolve a local-user session from the cookie so the stream enforces the
    // same permissions the REST API does for self-managed accounts.
    let localPrincipal: Principal | undefined;
    if (users) {
      const uid = readLocalSession(config.sessionSecret, req.headers.cookie);
      const user = uid ? users.get(uid) : null;
      if (user && !user.disabled) {
        localPrincipal = { subject: user.id, name: user.username, roles: user.roles };
      }
    }

    const decision = authorizeUpgrade(
      {
        pathname,
        headerToken,
        queryToken: searchParams.get('token') ?? undefined,
        cookieToken: sessionToken(req.headers.cookie),
        origin: req.headers.origin,
        localPrincipal,
      },
      config,
      (token) => verifyAgentToken(token),
      (token) => verifyToken(token, config, jwks),
    );

    if (!decision.ok) {
      rejectUpgrade(socket, decision.status);
      return;
    }

    if (connections >= config.maxConnections) {
      log.warn({ connections }, 'connection cap reached; rejecting upgrade');
      rejectUpgrade(socket, 503);
      return;
    }

    if (pathname === '/agent') {
      const agentName = decision.agentName ?? 'agent';
      agentWss.handleUpgrade(req, socket, head, (ws) => {
        track(ws);
        liveAgents.set(ws, headerToken ?? '');
        ws.on('close', () => liveAgents.delete(ws));
        handleAgentConnection(ws, ctx, agentName, peerAddress(req, config));
      });
      return;
    }

    clientWss.handleUpgrade(req, socket, head, (ws) => {
      track(ws);
      handleClientConnection(
        ws,
        ctx,
        req.socket.remoteAddress ?? 'unknown',
        decision.principal,
        decision.perms,
      );
    });
  });

  // Reload credentials periodically and drop agents whose credential was removed.
  const revocationTimer = setInterval(() => {
    credentials.reload();
    for (const [ws, token] of liveAgents) {
      if (verifyAgentToken(token) === null) {
        log.warn('agent credential revoked; closing connection');
        ws.close(1008, 'credential revoked');
      }
    }
  }, REVOCATION_INTERVAL_MS);
  revocationTimer.unref();

  const close = (): Promise<void> =>
    new Promise((resolve) => {
      clearInterval(revocationTimer);
      stopJwks?.();
      stopLoki?.();
      void bus.close();
      agentWss.close();
      clientWss.close();
      void deploys.close();
      server.close(() => resolve());
    });

  return { listening, close };
}

/**
 * Seed a first admin from FD_BOOTSTRAP_ADMIN (`username:password`) when the
 * local-user store is empty, so a fresh instance is reachable without a chicken-
 * and-egg lockout. Does nothing once any user exists.
 */
function seedBootstrapAdmin(
  users: UserStore,
  spec: string,
  log: { info: (obj: unknown, msg?: string) => void; warn: (msg: string) => void },
): void {
  if (!spec || users.count > 0) return;
  const idx = spec.indexOf(':');
  const username = idx > 0 ? spec.slice(0, idx).trim() : '';
  const password = idx > 0 ? spec.slice(idx + 1) : '';
  if (!username || password.length < MIN_PASSWORD_LENGTH) {
    log.warn(
      `FD_BOOTSTRAP_ADMIN ignored: expected "username:password" with a password of at least ${MIN_PASSWORD_LENGTH} characters`,
    );
    return;
  }
  users.create(username, password, ['admin']);
  log.info({ username }, 'seeded bootstrap admin from FD_BOOTSTRAP_ADMIN');
}
