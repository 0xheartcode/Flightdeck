import type { Config } from './config.js';
import { tokenOk } from './auth.js';
import { identityEnabled, type Principal } from './identity.js';

export interface UpgradeContext {
  pathname: string;
  /** Token from the Authorization header, if any. */
  headerToken?: string | undefined;
  /** Token from the ?token= query param (browsers can't set WS headers). */
  queryToken?: string | undefined;
  /** Token from the login session cookie, if the browser is signed in. */
  cookieToken?: string | undefined;
  /** Origin header of the handshake, if any. */
  origin?: string | undefined;
}

export interface UpgradeDecision {
  ok: boolean;
  /** HTTP status to reply with when not ok (ignored when ok). */
  status: number;
  /** Resolved agent name, set when an /agent upgrade is accepted. */
  agentName?: string;
  /** Authenticated user, set when identity is enabled and a /stream upgrade is accepted. */
  principal?: Principal;
}

/** Resolve a presented agent token to its name, or null if unknown. */
export type VerifyAgent = (token: string | undefined) => string | null;

/** Resolve a presented bearer token to a user principal, or null if invalid. */
export type VerifyClient = (token: string | undefined) => Principal | null;

const ACCEPT: UpgradeDecision = { ok: true, status: 101 };

/** Allow the configured UI origin, any origin when set to '*', or a non-browser
 * client that sends no Origin header (e.g. the agent or a CLI). */
export function originOk(origin: string | undefined, corsOrigin: string): boolean {
  if (corsOrigin === '*') return true;
  if (!origin) return true;
  return origin === corsOrigin;
}

/**
 * Decide whether a WebSocket upgrade is authorized. Pure: no sockets, no IO,
 * so it can be exhaustively tested. The server wiring in index.ts turns the
 * decision into an accept or an HTTP error.
 *
 *   /agent  - requires the agent token in the Authorization header only.
 *   /stream - requires a matching Origin, then: a valid JWT (header or query)
 *             when identity is enabled, else the dashboard token when one is
 *             configured, else open.
 *   other   - 404.
 */
export function authorizeUpgrade(
  ctx: UpgradeContext,
  config: Config,
  verifyAgent: VerifyAgent,
  verifyClient?: VerifyClient,
): UpgradeDecision {
  if (ctx.pathname === '/agent') {
    // Agents must use the Authorization header; the token never goes in the URL.
    const agentName = verifyAgent(ctx.headerToken);
    return agentName ? { ok: true, status: 101, agentName } : { ok: false, status: 401 };
  }

  if (ctx.pathname === '/stream') {
    if (!originOk(ctx.origin, config.corsOrigin)) {
      return { ok: false, status: 403 };
    }
    const presented = ctx.headerToken ?? ctx.queryToken ?? ctx.cookieToken;
    if (identityEnabled(config)) {
      const principal = verifyClient ? verifyClient(presented) : null;
      return principal ? { ok: true, status: 101, principal } : { ok: false, status: 401 };
    }
    if (config.dashboardToken && !tokenOk(config.dashboardToken, presented)) {
      return { ok: false, status: 401 };
    }
    return ACCEPT;
  }

  return { ok: false, status: 404 };
}
