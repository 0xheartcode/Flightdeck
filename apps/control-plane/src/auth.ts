import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string equality. Both inputs are hashed to a fixed-length
 * digest first, so neither the comparison nor the length leaks via timing.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Extract the token from an `Authorization: Bearer <token>` header. */
export function bearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, value] = header.split(' ');
  return scheme === 'Bearer' && value ? value : undefined;
}

/**
 * Check a presented token against the configured one.
 * An empty configured token denies everything (fail closed).
 */
export function tokenOk(configured: string, presented: string | undefined): boolean {
  if (!configured) return false;
  if (!presented) return false;
  return safeEqual(configured, presented);
}
