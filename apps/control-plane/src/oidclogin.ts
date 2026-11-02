import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Config } from './config.js';
import { logger } from './logger.js';

const log = logger.child({ component: 'oidc-login' });

/**
 * OIDC browser login: the authorization-code flow with PKCE.
 *
 * /auth/login sends the browser to the provider with a state and a PKCE
 * challenge (both carried in a short-lived signed cookie). /auth/callback
 * verifies the state, exchanges the code for an id_token at the token endpoint,
 * verifies that token, and drops it in a session cookie. The /api and /stream
 * auth then accept that cookie in addition to a bearer token, so a user signs
 * in with the provider instead of pasting a JWT.
 *
 * This complements the token-verification side (identity.ts): it is enabled
 * only when the client id and endpoints are configured, and it still produces a
 * provider-signed JWT that identity.ts verifies.
 */

/** Cookie holding the login state and PKCE verifier during the redirect. */
export const LOGIN_COOKIE = 'fd_login';
/** Cookie holding the signed-in user's id_token (a provider JWT). */
export const SESSION_COOKIE = 'fd_session';

/** True when the browser login flow is configured. */
export function loginFlowEnabled(config: Config): boolean {
  return Boolean(
    config.oidcClientId &&
    config.oidcAuthEndpoint &&
    config.oidcTokenEndpoint &&
    config.oidcRedirectUri &&
    config.sessionSecret,
  );
}

const b64url = (b: Buffer): string => b.toString('base64url');

/** A random PKCE verifier and its S256 challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** A random opaque state value. */
export function randomState(): string {
  return b64url(randomBytes(16));
}

/** Build the provider authorization URL for the redirect. */
export function buildAuthUrl(config: Config, state: string, challenge: string): string {
  const u = new URL(config.oidcAuthEndpoint);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', config.oidcClientId);
  u.searchParams.set('redirect_uri', config.oidcRedirectUri);
  u.searchParams.set('scope', config.oidcScopes);
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

/** Sign a string payload as `<payload>.<hmac>` (base64url), tamper-evident. */
export function sign(secret: string, payload: string): string {
  const p = Buffer.from(payload).toString('base64url');
  const sig = createHmac('sha256', secret).update(p).digest('base64url');
  return `${p}.${sig}`;
}

/** Verify and decode a value produced by sign(), or null if it was tampered with. */
export function unsign(secret: string, value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot < 0) return null;
  const p = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(p).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return Buffer.from(p, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

/** Exchange an authorization code for an id_token at the token endpoint. Never throws. */
export async function exchangeCode(
  config: Config,
  code: string,
  verifier: string,
): Promise<string | null> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.oidcRedirectUri,
    client_id: config.oidcClientId,
    code_verifier: verifier,
  });
  if (config.oidcClientSecret) body.set('client_secret', config.oidcClientSecret);
  try {
    const res = await fetch(config.oidcTokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
    });
    if (!res.ok) {
      log.warn({ status: res.status }, 'token endpoint rejected the code exchange');
      return null;
    }
    const json = (await res.json()) as { id_token?: unknown };
    return typeof json.id_token === 'string' ? json.id_token : null;
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'token exchange failed');
    return null;
  }
}

/** Parse a Cookie header into a name to value map. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    out[name] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

/** The session token (id_token) carried in the Cookie header, if any. */
export function sessionToken(cookieHeader: string | undefined): string | undefined {
  return parseCookies(cookieHeader)[SESSION_COOKIE];
}

/** Serialize a Set-Cookie value with the given attributes. */
export function cookie(
  name: string,
  value: string,
  opts: { maxAge?: number; secure?: boolean } = {},
): string {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts.secure) parts.push('Secure');
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  return parts.join('; ');
}
