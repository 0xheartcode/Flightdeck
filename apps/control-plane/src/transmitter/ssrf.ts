import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Guard outbound notification requests against SSRF. User-supplied channel URLs
 * must not be able to reach cloud metadata, loopback, link-local or private
 * ranges. We reject non-HTTP(S) schemes, block literal IPs in those ranges, and
 * resolve hostnames and check every returned address (so a hostname that maps to
 * 169.254.169.254 or 127.0.0.1 is refused too).
 */

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

function ipv4ToParts(ip: string): number[] | null {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    return null;
  return parts;
}

/** True when an IP literal falls in a blocked range. */
export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const p = ipv4ToParts(ip);
    if (!p) return true;
    const [a, b] = p as [number, number, number, number];
    if (a === 0) return true; // "this" network
    if (a === 10) return true; // private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (kind === 6) {
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::') return true; // loopback / unspecified
    if (low.startsWith('fe80')) return true; // link-local
    if (low.startsWith('fc') || low.startsWith('fd')) return true; // unique-local
    if (low.startsWith('::ffff:')) return isBlockedIp(low.slice(7)); // IPv4-mapped
    return false;
  }
  return true; // not a valid IP literal
}

/**
 * Assert that a URL is safe to call outbound. Throws SsrfError otherwise. Pass
 * `resolver` in tests to avoid real DNS.
 */
export async function assertOutboundAllowed(
  rawUrl: string,
  resolver: (host: string) => Promise<string[]> = defaultResolve,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError('invalid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SsrfError(`blocked scheme: ${url.protocol}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new SsrfError(`blocked address: ${host}`);
    return url;
  }
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new SsrfError('blocked host: localhost');
  }
  const addrs = await resolver(host);
  if (addrs.length === 0) throw new SsrfError(`could not resolve: ${host}`);
  for (const a of addrs) {
    if (isBlockedIp(a)) throw new SsrfError(`host ${host} resolves to blocked address ${a}`);
  }
  return url;
}

async function defaultResolve(host: string): Promise<string[]> {
  const results = await lookup(host, { all: true });
  return results.map((r) => r.address);
}
