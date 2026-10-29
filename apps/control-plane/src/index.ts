import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { serve } from '@hono/node-server';
import { WebSocketServer, type WebSocket } from 'ws';
import { loadConfig } from './config.js';
import { bearer } from './auth.js';
import { authorizeUpgrade } from './authorize.js';
import { CredentialStore } from './credentials.js';
import { CommandBus } from './commands.js';
import { Store } from './store.js';
import { createHttpApp } from './http.js';
import { handleAgentConnection } from './agent-hub.js';
import { handleClientConnection } from './client-hub.js';

const config = loadConfig();
const store = new Store(config.logBufferSize, config.maxServices);
const credentials = new CredentialStore(config);
const commands = new CommandBus(config.actionTimeoutMs);
const app = createHttpApp(store, config);

console.log(`[flightdeck] ${credentials.size} agent credential(s) loaded`);
console.log(`[flightdeck] actions ${config.actionsEnabled ? 'enabled' : 'disabled'}`);

// Two WebSocket endpoints share the HTTP server:
//   /agent   - authenticated, agents push logs/status/stats
//   /stream  - browsers subscribe to services and live logs
const agentWss = new WebSocketServer({ noServer: true, maxPayload: config.maxPayloadBytes });
const clientWss = new WebSocketServer({ noServer: true, maxPayload: config.maxPayloadBytes });

// Live agent connections with the token they presented, so a credential that
// is revoked (removed from the file) can have its connection dropped.
const liveAgents = new Map<WebSocket, string>();

clientWss.on('connection', (ws) => handleClientConnection(ws, store, commands, config));

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`[flightdeck] control plane listening on ${config.host}:${info.port}`);
  console.log(`[flightdeck]   agents  -> ws://${config.host}:${info.port}/agent`);
  console.log(`[flightdeck]   browser -> ws://${config.host}:${info.port}/stream`);
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
    reject(socket, decision.status);
    return;
  }

  if (pathname === '/agent') {
    const agentName = decision.agentName ?? 'agent';
    agentWss.handleUpgrade(req, socket, head, (ws) => {
      liveAgents.set(ws, headerToken ?? '');
      ws.on('close', () => liveAgents.delete(ws));
      handleAgentConnection(ws, store, commands, agentName);
    });
    return;
  }

  clientWss.handleUpgrade(req, socket, head, (ws) => clientWss.emit('connection', ws, req));
});

// Periodically reload credentials and disconnect agents whose credential was
// revoked (removed), so revocation takes effect without a restart.
const REVOCATION_INTERVAL_MS = 15_000;
const revocationTimer = setInterval(() => {
  credentials.reload();
  for (const [ws, token] of liveAgents) {
    if (credentials.verify(token) === null) {
      console.warn('[agent] credential revoked; closing connection');
      ws.close(1008, 'credential revoked');
    }
  }
}, REVOCATION_INTERVAL_MS);
revocationTimer.unref();

const REASONS: Record<number, string> = { 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found' };

function reject(socket: Duplex, code: number): void {
  socket.write(`HTTP/1.1 ${code} ${REASONS[code] ?? 'Bad Request'}\r\n\r\n`);
  socket.destroy();
}

function shutdown(signal: string): void {
  console.log(`[flightdeck] ${signal} received, shutting down`);
  agentWss.close();
  clientWss.close();
  server.close(() => process.exit(0));
  // Force-exit if connections do not drain promptly.
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
