import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateKeyPairSync, sign as signData, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { testConfig, mintHs256 } from './config.testutil.js';
import {
  identityEnabled,
  JwksCache,
  legacyPermissions,
  permissionsFor,
  verifyToken,
  type Principal,
} from './identity.js';

const SECRET = 'top-secret-signing-key';

/** Mint an RS256 JWT with a given private key, optionally with a header `kid`. */
function mintRs256(
  claims: Record<string, unknown>,
  privateKey: ReturnType<typeof genKeys>['privateKey'],
  kid?: string,
): string {
  const seg = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = seg({ alg: 'RS256', typ: 'JWT', ...(kid ? { kid } : {}) });
  const payload = seg(claims);
  const signature = signData(
    'RSA-SHA256',
    Buffer.from(`${header}.${payload}`),
    privateKey,
  ).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

function genKeys(): { publicKey: string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(), privateKey };
}

const future = Math.floor(Date.now() / 1000) + 3600;

describe('identityEnabled', () => {
  it('is off without a key and on with either key', () => {
    expect(identityEnabled(testConfig())).toBe(false);
    expect(identityEnabled(testConfig({ oidcHs256Secret: SECRET }))).toBe(true);
    expect(identityEnabled(testConfig({ oidcRs256PublicKey: 'pem' }))).toBe(true);
  });
});

describe('verifyToken (HS256)', () => {
  const config = testConfig({ oidcHs256Secret: SECRET });

  it('accepts a valid token and extracts subject, name, and roles', () => {
    const token = mintHs256({ sub: 'u1', name: 'Ada', roles: ['operator'], exp: future }, SECRET);
    expect(verifyToken(token, config)).toEqual<Principal>({
      subject: 'u1',
      name: 'Ada',
      roles: ['operator'],
    });
  });

  it('rejects a token signed with the wrong secret', () => {
    const token = mintHs256({ sub: 'u1', exp: future }, 'wrong-secret');
    expect(verifyToken(token, config)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = mintHs256({ sub: 'u1', exp: Math.floor(Date.now() / 1000) - 120 }, SECRET);
    expect(verifyToken(token, config)).toBeNull();
  });

  it('rejects a token not yet valid (nbf in the future)', () => {
    const token = mintHs256({ sub: 'u1', nbf: future, exp: future }, SECRET);
    expect(verifyToken(token, config)).toBeNull();
  });

  it('rejects a token with no subject', () => {
    const token = mintHs256({ roles: ['operator'], exp: future }, SECRET);
    expect(verifyToken(token, config)).toBeNull();
  });

  it('rejects the "none" algorithm', () => {
    const seg = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${seg({ alg: 'none', typ: 'JWT' })}.${seg({ sub: 'u1', exp: future })}.`;
    expect(verifyToken(unsigned, config)).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(verifyToken(undefined, config)).toBeNull();
    expect(verifyToken('not-a-jwt', config)).toBeNull();
    expect(verifyToken('a.b', config)).toBeNull();
    // Three segments, but the payload does not decode to a JSON object.
    expect(verifyToken('eyJhbGciOiJIUzI1NiJ9.bm90LWpzb24.sig', config)).toBeNull();
  });

  it('returns null (never throws) for a wrong-length signature', () => {
    // A valid header/payload but a truncated signature: the length guard must
    // make this return null rather than let the constant-time compare throw.
    const token = mintHs256({ sub: 'u1', exp: future }, SECRET);
    const truncated = `${token.slice(0, token.lastIndexOf('.') + 1)}AAAA`;
    expect(() => verifyToken(truncated, config)).not.toThrow();
    expect(verifyToken(truncated, config)).toBeNull();
  });

  it('enforces issuer and audience when configured', () => {
    const strict = testConfig({ oidcHs256Secret: SECRET, oidcIssuer: 'iss', oidcAudience: 'aud' });
    const good = mintHs256({ sub: 'u1', iss: 'iss', aud: 'aud', exp: future }, SECRET);
    const wrongIss = mintHs256({ sub: 'u1', iss: 'evil', aud: 'aud', exp: future }, SECRET);
    const wrongAud = mintHs256({ sub: 'u1', iss: 'iss', aud: 'other', exp: future }, SECRET);
    const arrayAud = mintHs256({ sub: 'u1', iss: 'iss', aud: ['x', 'aud'], exp: future }, SECRET);
    expect(verifyToken(good, strict)?.subject).toBe('u1');
    expect(verifyToken(wrongIss, strict)).toBeNull();
    expect(verifyToken(wrongAud, strict)).toBeNull();
    expect(verifyToken(arrayAud, strict)?.subject).toBe('u1');
  });

  it('reads roles from a dotted claim path and a space-delimited string', () => {
    const nested = testConfig({ oidcHs256Secret: SECRET, oidcRolesClaim: 'realm_access.roles' });
    const token = mintHs256(
      { sub: 'u1', realm_access: { roles: ['admin', 'operator'] }, exp: future },
      SECRET,
    );
    expect(verifyToken(token, nested)?.roles).toEqual(['admin', 'operator']);

    const spaced = mintHs256({ sub: 'u1', roles: 'operator admin', exp: future }, SECRET);
    expect(verifyToken(spaced, config)?.roles).toEqual(['operator', 'admin']);
  });
});

describe('verifyToken (RS256)', () => {
  it('accepts a token signed by the matching private key, rejects a tampered one', () => {
    const { publicKey, privateKey } = genKeys();
    const config = testConfig({ oidcRs256PublicKey: publicKey });
    const token = mintRs256({ sub: 'u1', roles: ['operator'], exp: future }, privateKey);
    expect(verifyToken(token, config)?.subject).toBe('u1');

    const other = genKeys();
    const forged = mintRs256({ sub: 'u1', exp: future }, other.privateKey);
    expect(verifyToken(forged, config)).toBeNull();
  });
});

describe('JwksCache (RS256 via JWKS)', () => {
  it('fetches keys and resolves a token by its kid, rejecting an unknown kid', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    (jwk as { kid?: string }).kid = 'key-1';

    const server: Server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const cache = new JwksCache(`http://127.0.0.1:${port}/jwks`);
      await cache.refresh();
      // Identity is on via the JWKS URI; verifyToken uses the passed cache.
      const config = testConfig({ oidcJwksUri: `http://127.0.0.1:${port}/jwks` });

      const good = mintRs256({ sub: 'u1', roles: ['operator'], exp: future }, privateKey, 'key-1');
      expect(verifyToken(good, config, cache)?.subject).toBe('u1');

      const wrongKid = mintRs256({ sub: 'u1', exp: future }, privateKey, 'key-unknown');
      expect(verifyToken(wrongKid, config, cache)).toBeNull();

      // No cache available at all: cannot resolve the key, so it fails closed.
      expect(verifyToken(good, config, undefined)).toBeNull();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('permissionsFor', () => {
  const p = (roles: string[]): Principal => ({ subject: 'u', roles });

  it('grants full access when no roles are configured (single-tenant)', () => {
    const perms = permissionsFor(p([]), [], []);
    expect([...perms].sort()).toEqual(['act', 'reveal', 'view']);
  });

  it('grants act for an operator role but not reveal', () => {
    const perms = permissionsFor(p(['operator']), ['operator'], ['admin']);
    expect(perms.has('view')).toBe(true);
    expect(perms.has('act')).toBe(true);
    expect(perms.has('reveal')).toBe(false);
  });

  it('grants act and reveal for an admin role', () => {
    const perms = permissionsFor(p(['admin']), ['operator'], ['admin']);
    expect(perms.has('act')).toBe(true);
    expect(perms.has('reveal')).toBe(true);
  });

  it('grants only view to a user without a privileged role', () => {
    const perms = permissionsFor(p(['viewer']), ['operator'], ['admin']);
    expect([...perms]).toEqual(['view']);
  });
});

describe('legacyPermissions', () => {
  it('is full access', () => {
    expect([...legacyPermissions()].sort()).toEqual(['act', 'reveal', 'view']);
  });
});
