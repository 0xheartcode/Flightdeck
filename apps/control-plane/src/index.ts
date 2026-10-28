import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { serve } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import { loadConfig } from './config.js';
import { bearer } from './auth.js';
import { authorizeUpgrade } from './authorize.js';
import { Store } from './store.js';
import { createHttpApp } from './http.js';
import { handleAgentConnection } from './agent-hub.js';
import { handleClientConnection } from './client-hub.js';

const config = loadConfig();
const store = new Store(config.logBufferSize, config.maxServices);
const app = createHttpApp(store, config);

// Two WebSocket endpoints share the HTTP server:
//   /agent   - authenticated, agents push logs/status/stats
//   /stream  - browsers subscribe to services and live logs
const agentWss = new WebSocketServer({ noServer: true, maxPayload: config.maxPayloadBytes });
const clientWss = new WebSocketServer({ noServer: true, maxPayload: config.maxPayloadBytes });

agentWss.on('connection', (ws) => handleAgentConnection(ws, store));
clientWss.on('connection', (ws) => handleClientConnection(ws, store));

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`[flightdeck] control plane listening on ${config.host}:${info.port}`);
  console.log(`[flightdeck]   agents  -> ws://${config.host}:${info.port}/agent`);
  console.log(`[flightdeck]   browser -> ws://${config.host}:${info.port}/stream`);
});

server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
  const { pathname, searchParams } = new URL(req.url ?? '', 'http://localhost');

  const decision = authorizeUpgrade(
    {
      pathname,
      headerToken: bearer(req.headers.authorization),
      queryToken: searchParams.get('token') ?? undefined,
      origin: req.headers.origin,
    },
    config,
  );

  if (!decision.ok) {
    reject(socket, decision.status);
    return;
  }

  const wss = pathname === '/agent' ? agentWss : clientWss;
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

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
