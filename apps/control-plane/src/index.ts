import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { serve } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import { createHttpApp } from './http.js';
import { handleAgentConnection } from './agent-hub.js';
import { handleClientConnection } from './client-hub.js';

const config = loadConfig();
const store = new Store(config.logBufferSize);
const app = createHttpApp(store);

// Two WebSocket endpoints share the HTTP server:
//   /agent   - authenticated, agents push logs/status/stats
//   /stream  - browsers subscribe to services and live logs
const agentWss = new WebSocketServer({ noServer: true });
const clientWss = new WebSocketServer({ noServer: true });

agentWss.on('connection', (ws) => handleAgentConnection(ws, store));
clientWss.on('connection', (ws) => handleClientConnection(ws, store));

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[flightdeck] control plane listening on http://localhost:${info.port}`);
  console.log(`[flightdeck]   agents  -> ws://localhost:${info.port}/agent`);
  console.log(`[flightdeck]   browser -> ws://localhost:${info.port}/stream`);
});

server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
  const { pathname, searchParams } = new URL(req.url ?? '', 'http://localhost');

  if (pathname === '/agent') {
    const token = bearer(req.headers.authorization) ?? searchParams.get('token') ?? '';
    if (!config.agentToken || token !== config.agentToken) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    agentWss.handleUpgrade(req, socket, head, (ws) => agentWss.emit('connection', ws, req));
    return;
  }

  if (pathname === '/stream') {
    clientWss.handleUpgrade(req, socket, head, (ws) => clientWss.emit('connection', ws, req));
    return;
  }

  socket.destroy();
});

function bearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, value] = header.split(' ');
  return scheme === 'Bearer' ? value : undefined;
}
