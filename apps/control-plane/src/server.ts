import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { serve } from '@hono/node-server';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Config } from './config.js';
import type { Context } from './context.js';
import { logger } from './logger.js';
import { bearer } from './auth.js';
import { authorizeUpgrade } from './authorize.js';
import { CredentialStore } from './credentials.js';
import { CommandBus } from './commands.js';
import { AuditLog } from './audit.js';
import { Metrics } from './metrics.js';
import { Store } from './store.js';
import { createHttpApp } from './http.js';
import { handleAgentConnection } from './agent-hub.js';
import { handleClientConnection } from './client-hub.js';

const REVOCATION_INTERVAL_MS = 15_000;
const REASONS: Record<number, string> = { 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found' };

export interface ControlPlaneHandle {
  /** Resolves with the bound port once the server is listening. */
  listening: Promise<number>;
  close: () => Promise<void>;
}

/** Build and start the control plane. Returns a handle for tests and shutdown. */
export function startControlPlane(config: Config): ControlPlaneHandle {
  const log = logger.child({ component: 'control-plane' });

  const credentials = new CredentialStore(config);
  const ctx: Context = {
    config,
    store: new Store(config.logBufferSize, config.maxServices),
    commands: new CommandBus(config.actionTimeoutMs),
    audit: new AuditLog(config.auditMax, config.auditFile || undefined),
    metrics: new Metrics(),
  };

  log.info(
    { credentials: credentials.size, actions: config.actionsEnabled },
    'control plane starting',
  );

  const agentWss = new WebSocketServer({ noServer: true, maxPayload: config.maxPayloadBytes });
  const clientWss = new WebSocketServer({ noServer: true, maxPayload: config.maxPayloadBytes });

  // Live agent connections with the token they presented, so a revoked
  // credential can have its connection dropped.
  const liveAgents = new Map<WebSocket, string>();

  const app = createHttpApp(ctx, () => liveAgents.size);

  clientWss.on('connection', (ws, req: IncomingMessage) => {
    handleClientConnection(ws, ctx, req.socket.remoteAddress ?? 'unknown');
  });

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

    const decision = authorizeUpgrade(
      {
        pathname,
        headerToken,
        queryToken: searchParams.get('token') ?? undefined,
        origin: req.headers.origin,
      },
      config,
      (token) => credentials.verify(token),
    );

    if (!decision.ok) {
      socket.write(
        `HTTP/1.1 ${decision.status} ${REASONS[decision.status] ?? 'Bad Request'}\r\n\r\n`,
      );
      socket.destroy();
      return;
    }

    if (pathname === '/agent') {
      const agentName = decision.agentName ?? 'agent';
      agentWss.handleUpgrade(req, socket, head, (ws) => {
        liveAgents.set(ws, headerToken ?? '');
        ws.on('close', () => liveAgents.delete(ws));
        handleAgentConnection(ws, ctx, agentName);
      });
      return;
    }

    clientWss.handleUpgrade(req, socket, head, (ws) => clientWss.emit('connection', ws, req));
  });

  // Reload credentials periodically and drop agents whose credential was removed.
  const revocationTimer = setInterval(() => {
    credentials.reload();
    for (const [ws, token] of liveAgents) {
      if (credentials.verify(token) === null) {
        log.warn('agent credential revoked; closing connection');
        ws.close(1008, 'credential revoked');
      }
    }
  }, REVOCATION_INTERVAL_MS);
  revocationTimer.unref();

  const close = (): Promise<void> =>
    new Promise((resolve) => {
      clearInterval(revocationTimer);
      agentWss.close();
      clientWss.close();
      server.close(() => resolve());
    });

  return { listening, close };
}
