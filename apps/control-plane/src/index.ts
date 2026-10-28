import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { serve } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import { loadConfig } from './config.js';
import { bearer, tokenOk } from './auth.js';
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
  const headerToken = bearer(req.headers.authorization);

  if (pathname === '/agent') {
    // Agents must use the Authorization header; the token never goes in the URL.
    if (!tokenOk(config.agentToken, headerToken)) {
      reject(socket, 401);
      return;
    }
    agentWss.handleUpgrade(req, socket, head, (ws) => agentWss.emit('connection', ws, req));
    return;
  }

  if (pathname === '/stream') {
    // Reject cross-origin browser connections (WebSockets bypass CORS).
    if (!originOk(req.headers.origin)) {
      reject(socket, 403);
      return;
    }
    // Browsers cannot set headers on a WebSocket, so accept ?token= here too.
    // Gated only when a dashboard token is configured.
    if (config.dashboardToken) {
      const presented = headerToken ?? searchParams.get('token') ?? undefined;
      if (!tokenOk(config.dashboardToken, presented)) {
        reject(socket, 401);
        return;
      }
    }
    clientWss.handleUpgrade(req, socket, head, (ws) => clientWss.emit('connection', ws, req));
    return;
  }

  reject(socket, 404);
});

/** Allow the configured UI origin (or any origin when explicitly set to '*'). */
function originOk(origin: string | undefined): boolean {
  if (config.corsOrigin === '*') return true;
  // No Origin header means a non-browser client (e.g. a CLI); allow it.
  if (!origin) return true;
  return origin === config.corsOrigin;
}

function reject(socket: Duplex, code: number): void {
  const reason = code === 401 ? 'Unauthorized' : 'Not Found';
  socket.write(`HTTP/1.1 ${code} ${reason}\r\n\r\n`);
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
