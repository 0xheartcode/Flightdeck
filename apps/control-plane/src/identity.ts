import {
  createHmac,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
  type KeyObject,
} from 'node:crypto';
import type { Config } from './config.js';
import { logger } from './logger.js';

const log = logger.child({ component: 'identity' });

/**
 * User identity and role-based access control.
 *
 * The control plane verifies a JWT bearer token (presented by the browser on
 * the stream and the REST API) against a configured key, extracts the user and
 * their roles, and maps those roles to permissions. This works with any OIDC
 * provider that issues JWTs: configure the HS256 shared secret for a symmetric
 * setup, the RS256 public key (PEM) for a static asymmetric one, or a JWKS
 * endpoint (FD_OIDC_JWKS_URI) to track a provider's rotating RS256 keys. JWKS
 * keys are fetched and refreshed in the background (see JwksCache), so token
 * verification itself stays synchronous and reads an in-memory cache.
 *
 * Identity is OFF unless a key or JWKS URI is configured. When off, the legacy
 * single dashboard token applies and every caller is treated as a trusted
 * operator, so existing deployments are unaffected.
 */

/** Resolves an RS256 signing key by its JWT `kid`. */
export interface KeyResolver {
  getKey(kid: string): KeyObject | undefined;
}

/** An authenticated user resolved from a verified token. */
export interface Principal {
  /** Stable user id (the token's `sub`). */
  subject: string;
  /** Human-friendly name for display and the audit log, if the token carries one. */
  name?: string;
  /** Roles extracted from the configured claim. */
  roles: string[];
}

/** What a caller is allowed to do. */
export type Permission = 'view' | 'act' | 'reveal';

/** Clock-skew leeway (seconds) applied to exp and nbf checks. */
const LEEWAY_SECONDS = 60;

/** True when a verification key or JWKS URI is configured, i.e. identity is enforced. */
export function identityEnabled(config: Config): boolean {
  return Boolean(config.oidcHs256Secret || config.oidcRs256PublicKey || config.oidcJwksUri);
}

function decodeSegment(segment: string): unknown {
  const json = Buffer.from(segment, 'base64url').toString('utf8');
  return JSON.parse(json);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Resolve the RS256 public key: a configured static PEM, else the JWKS key for the token's kid. */
function resolveRs256Key(
  config: Config,
  header: Record<string, unknown>,
  jwks: KeyResolver | undefined,
): KeyObject | null {
  if (config.oidcRs256PublicKey) {
    try {
      return createPublicKey(config.oidcRs256PublicKey);
    } catch {
      return null;
    }
  }
  const kid = typeof header.kid === 'string' ? header.kid : undefined;
  if (jwks && kid) return jwks.getKey(kid) ?? null;
  return null;
}

/** Verify the token signature for the header's algorithm. */
function signatureOk(
  config: Config,
  header: Record<string, unknown>,
  signingInput: string,
  signature: Buffer,
  jwks: KeyResolver | undefined,
): boolean {
  if (header.alg === 'HS256') {
    if (!config.oidcHs256Secret) return false;
    const expected = createHmac('sha256', config.oidcHs256Secret).update(signingInput).digest();
    return signature.length === expected.length && timingSafeEqual(signature, expected);
  }
  if (header.alg === 'RS256') {
    const key = resolveRs256Key(config, header, jwks);
    if (!key) return false;
    try {
      return verifySignature('RSA-SHA256', Buffer.from(signingInput), key, signature);
    } catch {
      return false;
    }
  }
  // Reject "none" and any algorithm we do not explicitly support.
  return false;
}

/** Read roles from a (possibly dotted) claim path; accept an array or a delimited string. */
function extractRoles(payload: Record<string, unknown>, claimPath: string): string[] {
  let current: unknown = payload;
  for (const part of claimPath.split('.')) {
    if (!isObject(current)) return [];
    current = current[part];
  }
  if (Array.isArray(current)) {
    return current.filter((r): r is string => typeof r === 'string');
  }
  if (typeof current === 'string') {
    return current.split(/[\s,]+/).filter(Boolean);
  }
  return [];
}

function audienceOk(configured: string, aud: unknown): boolean {
  if (!configured) return true;
  if (typeof aud === 'string') return aud === configured;
  if (Array.isArray(aud)) return aud.includes(configured);
  return false;
}

/**
 * Verify a bearer token and return its principal, or null if it is missing,
 * malformed, unsigned by the configured key, expired, or fails an issuer or
 * audience check. Never throws.
 */
export function verifyToken(
  token: string | undefined,
  config: Config,
  jwks?: KeyResolver,
): Principal | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerSeg, payloadSeg, signatureSeg] = parts as [string, string, string];

  let header: unknown;
  let payload: unknown;
  try {
    header = decodeSegment(headerSeg);
    payload = decodeSegment(payloadSeg);
  } catch {
    return null;
  }
  if (!isObject(header) || !isObject(payload)) return null;

  const signature = Buffer.from(signatureSeg, 'base64url');
  if (!signatureOk(config, header, `${headerSeg}.${payloadSeg}`, signature, jwks)) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && now - LEEWAY_SECONDS >= payload.exp) return null;
  if (typeof payload.nbf === 'number' && now + LEEWAY_SECONDS < payload.nbf) return null;
  if (config.oidcIssuer && payload.iss !== config.oidcIssuer) return null;
  if (!audienceOk(config.oidcAudience, payload.aud)) return null;

  const subject = typeof payload.sub === 'string' ? payload.sub : undefined;
  if (!subject) return null;

  const name = [payload.name, payload.preferred_username, payload.email].find(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );

  return { subject, name, roles: extractRoles(payload, config.oidcRolesClaim) };
}

/**
 * Map a principal's roles to permissions. Everyone authenticated may view.
 * When no roles are configured, identity alone grants full operator access
 * (the single-tenant case). Otherwise, an operator or admin role grants `act`,
 * and only an admin role grants `reveal` (unmasking env values).
 */
export function permissionsFor(
  principal: Principal,
  operatorRoles: string[],
  adminRoles: string[],
): Set<Permission> {
  const perms = new Set<Permission>(['view']);
  const rolesConfigured = operatorRoles.length > 0 || adminRoles.length > 0;
  if (!rolesConfigured) {
    perms.add('act');
    perms.add('reveal');
    return perms;
  }
  const has = (roles: string[]): boolean => principal.roles.some((r) => roles.includes(r));
  if (has(operatorRoles) || has(adminRoles)) perms.add('act');
  if (has(adminRoles)) perms.add('reveal');
  return perms;
}

/** The permissions a caller in legacy (identity-disabled) mode holds: all. */
export function legacyPermissions(): Set<Permission> {
  return new Set<Permission>(['view', 'act', 'reveal']);
}

/**
 * Fetches an OIDC JWKS endpoint and caches the RSA signing keys by `kid`, so
 * RS256 tokens verify against a provider's rotating keys without a per-request
 * fetch. Refreshed on a timer; verification reads the cache synchronously.
 */
export class JwksCache implements KeyResolver {
  private keys = new Map<string, KeyObject>();

  constructor(
    private readonly uri: string,
    private readonly refreshMs = 300_000,
  ) {}

  getKey(kid: string): KeyObject | undefined {
    return this.keys.get(kid);
  }

  /** Fetch the JWKS and replace the cache. Throws on a network or parse error. */
  async refresh(): Promise<void> {
    const res = await fetch(this.uri);
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    const body = (await res.json()) as { keys?: unknown[] };
    const next = new Map<string, KeyObject>();
    for (const entry of body.keys ?? []) {
      if (!isObject(entry) || entry.kty !== 'RSA' || typeof entry.kid !== 'string') continue;
      try {
        next.set(
          entry.kid,
          createPublicKey({ key: entry, format: 'jwk' } as Parameters<typeof createPublicKey>[0]),
        );
      } catch {
        // Skip a malformed key rather than fail the whole refresh.
      }
    }
    this.keys = next;
  }

  /** Refresh now and on an interval; returns a stop function. Never throws. */
  start(): () => void {
    const tick = (): void => {
      this.refresh().catch((err) => {
        log.warn({ err: (err as Error).message, uri: this.uri }, 'JWKS refresh failed');
      });
    };
    tick();
    const timer = setInterval(tick, this.refreshMs);
    timer.unref();
    return () => clearInterval(timer);
  }
}

/** Log once at startup how identity is configured, so an operator can confirm it. */
export function logIdentityConfig(config: Config): void {
  if (!identityEnabled(config)) return;
  const mode = config.oidcHs256Secret
    ? 'HS256'
    : config.oidcJwksUri
      ? 'RS256 (JWKS)'
      : 'RS256 (static key)';
  const rolesConfigured = config.operatorRoles.length > 0 || config.adminRoles.length > 0;
  log.info(
    { mode, issuer: config.oidcIssuer || undefined, rolesConfigured },
    'identity enabled (JWT bearer required for the stream and API)',
  );
  if (!rolesConfigured) {
    log.warn(
      'no FD_OPERATOR_ROLES or FD_ADMIN_ROLES set; every authenticated user may act and reveal env values',
    );
  }
}
