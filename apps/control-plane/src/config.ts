import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface Config {
  host: string;
  port: number;
  /** Shared bearer token agents must present. Empty = reject all agents. */
  agentToken: string;
  /** Optional token the browser API + stream require. Empty = open (dev). */
  dashboardToken: string;
  /** Allowed CORS origin for the REST API. '*' allows any (not recommended). */
  corsOrigin: string;
  /** Max recent log lines kept in memory per service. */
  logBufferSize: number;
  /** Max WebSocket frame size in bytes (both agent and browser sockets). */
  maxPayloadBytes: number;
  /** Cap on the number of distinct services held in the registry. */
  maxServices: number;
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Load a `.env` file into process.env if one exists, searching from the
 * current directory up to the repo root. Lets `pnpm dev` (cwd = app dir) and
 * `node dist/index.js` both pick up the repo-root `.env`.
 */
function loadDotenv(): void {
  const loader = (process as { loadEnvFile?: (path: string) => void }).loadEnvFile;
  if (typeof loader !== 'function') return;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      try {
        loader(candidate);
      } catch {
        // Ignore a malformed .env; explicit env vars still apply.
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

export function loadConfig(): Config {
  loadDotenv();

  const config: Config = {
    host: process.env.FD_CONTROL_PLANE_HOST ?? '0.0.0.0',
    port: num(process.env.FD_CONTROL_PLANE_PORT, 4000),
    agentToken: process.env.FD_AGENT_TOKEN ?? '',
    dashboardToken: process.env.FD_DASHBOARD_TOKEN ?? '',
    corsOrigin: process.env.FD_CORS_ORIGIN ?? 'http://localhost:5173',
    logBufferSize: num(process.env.FD_LOG_BUFFER_SIZE, 2000),
    maxPayloadBytes: num(process.env.FD_MAX_PAYLOAD_BYTES, 262_144),
    maxServices: num(process.env.FD_MAX_SERVICES, 1000),
  };

  if (!config.agentToken) {
    console.warn('[config] FD_AGENT_TOKEN is empty; all agent connections will be rejected.');
  }
  if (!config.dashboardToken) {
    console.warn(
      '[config] FD_DASHBOARD_TOKEN is empty; the browser API and log stream are UNAUTHENTICATED. ' +
        'Set it, or keep the control plane on a trusted network only.',
    );
  }
  if (config.corsOrigin === '*') {
    console.warn('[config] FD_CORS_ORIGIN is "*"; any website can call the API from a browser.');
  }

  return config;
}
