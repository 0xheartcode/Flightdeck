import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { logger } from './logger.js';

export interface Config {
  host: string;
  port: number;
  /** Single shared agent token (fallback when no per-agent credentials set). */
  agentToken: string;
  /** Inline per-agent credentials: `name:token` entries, comma or newline separated. */
  agentTokens: string;
  /** Path to a file of per-agent `name:token` lines (hot-reloaded for revocation). */
  agentTokensFile: string;
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
  /** Whether operator actions (restart) are allowed. Off by default. */
  actionsEnabled: boolean;
  /** How long to wait for an agent to report a command result. */
  actionTimeoutMs: number;
  /** Max audit entries kept in memory (served at /api/audit). */
  auditMax: number;
  /** Optional path to append the audit trail as JSONL (survives restart). */
  auditFile: string;
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
    agentTokens: process.env.FD_AGENT_TOKENS ?? '',
    agentTokensFile: process.env.FD_AGENT_TOKENS_FILE ?? '',
    dashboardToken: process.env.FD_DASHBOARD_TOKEN ?? '',
    corsOrigin: process.env.FD_CORS_ORIGIN ?? 'http://localhost:5173',
    logBufferSize: num(process.env.FD_LOG_BUFFER_SIZE, 2000),
    maxPayloadBytes: num(process.env.FD_MAX_PAYLOAD_BYTES, 262_144),
    maxServices: num(process.env.FD_MAX_SERVICES, 1000),
    actionsEnabled: process.env.FD_ENABLE_ACTIONS === 'true',
    actionTimeoutMs: num(process.env.FD_ACTION_TIMEOUT_MS, 20_000),
    auditMax: num(process.env.FD_AUDIT_MAX, 500),
    auditFile: process.env.FD_AUDIT_LOG_FILE ?? '',
  };

  // Agent-credential presence is validated by the CredentialStore, which
  // warns when none are configured (FD_AGENT_TOKEN / FD_AGENT_TOKENS[_FILE]).
  const log = logger.child({ component: 'config' });
  if (!config.dashboardToken) {
    log.warn(
      'FD_DASHBOARD_TOKEN is empty; the browser API and log stream are UNAUTHENTICATED. ' +
        'Set it, or keep the control plane on a trusted network only.',
    );
  }
  if (config.corsOrigin === '*') {
    log.warn('FD_CORS_ORIGIN is "*"; any website can call the API from a browser.');
  }
  if (config.actionsEnabled && !config.dashboardToken) {
    log.warn(
      'FD_ENABLE_ACTIONS is on without FD_DASHBOARD_TOKEN; anyone who can reach the stream ' +
        'can restart or redeploy containers. Set a dashboard token or restrict the network.',
    );
  }

  return config;
}
