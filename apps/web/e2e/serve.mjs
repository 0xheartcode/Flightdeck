/* eslint-disable no-console -- this is a boot script; console is its output. */
// E2E boot: build both apps, start the control plane with a fake agent that
// announces one service and streams a log, and serve the web bundle. Playwright
// waits for the web URL, then runs the specs against this stack.
import { execSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const here = fileURLToPath(new URL('.', import.meta.url));
const webRoot = join(here, '..');
const repoRoot = join(webRoot, '..', '..');
const CP_PORT = 4300;
const WEB_PORT = 4310;
const TOKEN = 'e2e-token';
const CP_URL = `http://127.0.0.1:${CP_PORT}`;

// 1. Build the shared protocol first (both apps depend on its dist), then the
// control plane and the web bundle (pointed at the test control plane).
execSync('pnpm --filter @flightdeck/protocol build', { cwd: repoRoot, stdio: 'inherit' });
execSync('pnpm --filter @flightdeck/control-plane build', { cwd: repoRoot, stdio: 'inherit' });
execSync('pnpm --filter @flightdeck/web build', {
  cwd: repoRoot,
  stdio: 'inherit',
  env: { ...process.env, VITE_FD_API_URL: CP_URL },
});

// 2. Start the control plane (agents authenticate with TOKEN; browser open).
const cp = spawn('node', [join(repoRoot, 'apps/control-plane/dist/index.js')], {
  env: {
    ...process.env,
    FD_CONTROL_PLANE_HOST: '127.0.0.1',
    FD_CONTROL_PLANE_PORT: String(CP_PORT),
    FD_AGENT_TOKEN: TOKEN,
    // A specific origin (not '*') so credentialed browser fetches are allowed.
    FD_CORS_ORIGIN: `http://127.0.0.1:${WEB_PORT}`,
  },
  stdio: 'inherit',
});

async function waitHttp(url) {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${url}`);
}
await waitHttp(`${CP_URL}/healthz`);

// 3. A fake agent: one service, a log line every 500ms.
const v = 1;
const agent = new WebSocket(`ws://127.0.0.1:${CP_PORT}/agent`, {
  headers: { Authorization: `Bearer ${TOKEN}` },
});
agent.on('open', () => {
  agent.send(JSON.stringify({ v, type: 'hello', agentId: 'e2e', hostname: 'e2e-host' }));
  agent.send(
    JSON.stringify({
      v,
      type: 'service',
      service: {
        id: 'e2e-host/demo',
        name: 'demo',
        image: 'alpine',
        containerId: 'c',
        state: 'running',
        host: 'e2e-host',
        createdAt: 0,
      },
    }),
  );
  setInterval(
    () =>
      agent.send(
        JSON.stringify({
          v,
          type: 'log',
          log: {
            serviceId: 'e2e-host/demo',
            stream: 'stdout',
            ts: Date.now(),
            line: 'E2E hello world',
          },
        }),
      ),
    500,
  );
});

// 4. Serve the web bundle (SPA fallback to index.html).
const dist = join(webRoot, 'dist');
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};
createServer((req, res) => {
  let file = join(dist, decodeURIComponent((req.url || '/').split('?')[0]));
  if (!existsSync(file) || file.endsWith('/')) file = join(dist, 'index.html');
  try {
    res.setHeader('content-type', mime[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
}).listen(WEB_PORT, '127.0.0.1', () =>
  console.log(`e2e web ready on http://127.0.0.1:${WEB_PORT}`),
);

const shutdown = () => {
  cp.kill();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
