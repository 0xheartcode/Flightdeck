// Flightdeck status page — a tiny, zero-dependency Kuma-in-miniature.
//
// Actively polls each configured monitor over HTTP, keeps a rolling in-memory
// history per monitor, and serves both a styled page and a JSON/metrics API.
// No database: history is intentionally ephemeral (restart = fresh slate),
// which is the right trade for an at-a-glance status board.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.FDW_STATUS_PORT ?? 8090);
const INTERVAL = Number(process.env.FDW_STATUS_INTERVAL_MS ?? 30_000);
const HISTORY = Number(process.env.FDW_STATUS_HISTORY ?? 60);
const TIMEOUT = Number(process.env.FDW_STATUS_TIMEOUT_MS ?? 5_000);

const configPath = process.env.FDW_MONITORS ?? join(__dirname, 'monitors.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const indexHtml = readFileSync(join(__dirname, 'index.html'), 'utf8');

// Flatten the grouped config into a check list while remembering the group.
const monitors = [];
for (const group of config.groups ?? []) {
  for (const m of group.monitors ?? []) {
    monitors.push({
      group: group.name,
      name: m.name,
      url: m.url,
      accept: m.accept ?? [200],
      history: [], // [{ t, up, code, latencyMs }]
    });
  }
}

async function checkOne(m) {
  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  let up = false;
  let code = 0;
  try {
    const res = await fetch(m.url, { signal: ctl.signal, redirect: 'manual' });
    code = res.status;
    up = m.accept.includes(res.status);
  } catch {
    up = false; // timeout, DNS, connection refused -> down
  } finally {
    clearTimeout(timer);
  }
  const point = { t: Date.now(), up, code, latencyMs: Date.now() - started };
  m.history.push(point);
  if (m.history.length > HISTORY) m.history.shift();
}

async function pollAll() {
  await Promise.all(monitors.map(checkOne));
}

function uptimePct(m) {
  if (!m.history.length) return null;
  const ups = m.history.filter((p) => p.up).length;
  return Math.round((ups / m.history.length) * 1000) / 10;
}

function snapshot() {
  const byGroup = new Map();
  for (const m of monitors) {
    const last = m.history.at(-1);
    const item = {
      name: m.name,
      url: m.url,
      status: last ? (last.up ? 'up' : 'down') : 'unknown',
      code: last?.code ?? null,
      latencyMs: last?.latencyMs ?? null,
      uptimePct: uptimePct(m),
      history: m.history.map((p) => (p.up ? 1 : 0)),
    };
    if (!byGroup.has(m.group)) byGroup.set(m.group, []);
    byGroup.get(m.group).push(item);
  }
  const groups = [...byGroup].map(([name, items]) => ({ name, monitors: items }));
  const allUp = monitors.every((m) => m.history.at(-1)?.up);
  const anyDown = monitors.some((m) => m.history.at(-1) && !m.history.at(-1).up);
  const overall = !monitors.some((m) => m.history.length)
    ? 'unknown'
    : allUp
      ? 'operational'
      : anyDown
        ? 'outage'
        : 'degraded';
  return {
    title: config.title ?? 'Flightdeck Status',
    updatedAt: Date.now(),
    overall,
    groups,
  };
}

function metrics() {
  const lines = [
    '# HELP flightdeck_watcher_up Whether a monitored endpoint is up (1) or down (0).',
    '# TYPE flightdeck_watcher_up gauge',
  ];
  for (const m of monitors) {
    const last = m.history.at(-1);
    const v = last?.up ? 1 : 0;
    lines.push(`flightdeck_watcher_up{monitor="${m.name}",group="${m.group}"} ${v}`);
  }
  lines.push('# HELP flightdeck_watcher_latency_ms Last probe latency in milliseconds.');
  lines.push('# TYPE flightdeck_watcher_latency_ms gauge');
  for (const m of monitors) {
    const last = m.history.at(-1);
    if (last) {
      lines.push(
        `flightdeck_watcher_latency_ms{monitor="${m.name}",group="${m.group}"} ${last.latencyMs}`,
      );
    }
  }
  return lines.join('\n') + '\n';
}

const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
  } else if (req.url === '/api/status') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(snapshot()));
  } else if (req.url === '/metrics') {
    res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' }).end(metrics());
  } else if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(indexHtml);
  } else {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
});

// Probe once immediately so the page is populated on first load, then loop.
await pollAll();
setInterval(pollAll, INTERVAL);
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`flightdeck-watcher status page on :${PORT} (${monitors.length} monitors)`);
});
