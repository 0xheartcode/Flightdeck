import {
  createHmac,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
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
 * setup, or the RS256 public key (PEM) for an asymmetric one. Verification uses
 * only node:crypto, so there is no network dependency and no JWKS fetch; a
 * rotating JWKS endpoint is a later addition.
 *
 * Identity is OFF unless a key is configured. When off, the legacy single
 * dashboard token applies and every caller is treated as a trusted operator,
 * so existing deployments are unaffected.
 */

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

/** True when a verification key is configured, i.e. identity is enforced. */
export function identityEnabled(config: Config): boolean {
  return Boolean(config.oidcHs256Secret || config.oidcRs256PublicKey);
}

function decodeSegment(segment: string): unknown {
  const json = Buffer.from(segment, 'base64url').toString('utf8');
  return JSON.parse(json);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Verify the token signature for the header's algorithm. */
function signatureOk(
  config: Config,
  alg: unknown,
  signingInput: string,
  signature: Buffer,
): boolean {
  if (alg === 'HS256') {
    if (!config.oidcHs256Secret) return false;
    const expected = createHmac('sha256', config.oidcHs256Secret).update(signingInput).digest();
    return signature.length === expected.length && timingSafeEqual(signature, expected);
  }
  if (alg === 'RS256') {
    if (!config.oidcRs256PublicKey) return false;
    try {
      const key = createPublicKey(config.oidcRs256PublicKey);
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
export function verifyToken(token: string | undefined, config: Config): Principal | null {
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
  if (!signatureOk(config, header.alg, `${headerSeg}.${payloadSeg}`, signature)) return null;

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

/** Log once at startup how identity is configured, so an operator can confirm it. */
export function logIdentityConfig(config: Config): void {
  if (!identityEnabled(config)) return;
  const alg = config.oidcHs256Secret ? 'HS256' : 'RS256';
  const rolesConfigured = config.operatorRoles.length > 0 || config.adminRoles.length > 0;
  log.info(
    { alg, issuer: config.oidcIssuer || undefined, rolesConfigured },
    'identity enabled (JWT bearer required for the stream and API)',
  );
  if (!rolesConfigured) {
    log.warn(
      'no FD_OPERATOR_ROLES or FD_ADMIN_ROLES set; every authenticated user may act and reveal env values',
    );
  }
}
