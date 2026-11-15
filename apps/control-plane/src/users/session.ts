import { parseCookies, sign, unsign } from '../oidclogin.js';

/**
 * Local-user sessions.
 *
 * Distinct from the OIDC session (which carries a provider JWT in `fd_session`):
 * a local login stores an HMAC-signed `{uid, iat}` payload in its own cookie.
 * The auth middleware resolves it to a user via the UserStore, so a local
 * session never has to be a JWT and the two paths cannot collide.
 */
export const LOCAL_SESSION_COOKIE = 'fd_local';

/** Session lifetime in seconds (8 hours), matching the OIDC session cookie. */
export const LOCAL_SESSION_MAX_AGE = 28_800;

interface LocalSession {
  uid: string;
  iat: number;
}

/** Produce a signed session value for a user id. */
export function issueLocalSession(secret: string, uid: string): string {
  const payload: LocalSession = { uid, iat: Math.floor(Date.now() / 1000) };
  return sign(secret, JSON.stringify(payload));
}

/** Read and verify the local session user id from a Cookie header, or null. */
export function readLocalSession(secret: string, cookieHeader: string | undefined): string | null {
  const raw = parseCookies(cookieHeader)[LOCAL_SESSION_COOKIE];
  const json = unsign(secret, raw);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<LocalSession>;
    const maxAgeMs = LOCAL_SESSION_MAX_AGE * 1000;
    if (
      typeof parsed.uid === 'string' &&
      typeof parsed.iat === 'number' &&
      Date.now() - parsed.iat * 1000 < maxAgeMs
    ) {
      return parsed.uid;
    }
    return null;
  } catch {
    return null;
  }
}
