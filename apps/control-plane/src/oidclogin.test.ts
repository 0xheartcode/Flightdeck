import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { testConfig } from './config.testutil.js';
import {
  buildAuthUrl,
  cookie,
  loginFlowEnabled,
  parseCookies,
  pkcePair,
  randomState,
  sessionToken,
  sign,
  unsign,
} from './oidclogin.js';

const SECRET = 'session-signing-secret';

describe('loginFlowEnabled', () => {
  it('is off until the client and endpoints are all configured', () => {
    expect(loginFlowEnabled(testConfig())).toBe(false);
    expect(
      loginFlowEnabled(
        testConfig({
          oidcClientId: 'c',
          oidcAuthEndpoint: 'https://idp/auth',
          oidcTokenEndpoint: 'https://idp/token',
          oidcRedirectUri: 'https://cp/auth/callback',
          sessionSecret: SECRET,
        }),
      ),
    ).toBe(true);
  });
});

describe('pkcePair', () => {
  it('derives the S256 challenge from the verifier', () => {
    const { verifier, challenge } = pkcePair();
    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(expected);
    expect(verifier).not.toBe(pkcePair().verifier); // random each time
  });
});

describe('buildAuthUrl', () => {
  it('carries the OIDC authorization-code + PKCE parameters', () => {
    const config = testConfig({
      oidcClientId: 'client-123',
      oidcAuthEndpoint: 'https://idp.example/authorize',
      oidcRedirectUri: 'https://cp.example/auth/callback',
      oidcScopes: 'openid email',
    });
    const url = new URL(buildAuthUrl(config, 'st8', 'chal'));
    expect(url.origin + url.pathname).toBe('https://idp.example/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('redirect_uri')).toBe('https://cp.example/auth/callback');
    expect(url.searchParams.get('scope')).toBe('openid email');
    expect(url.searchParams.get('state')).toBe('st8');
    expect(url.searchParams.get('code_challenge')).toBe('chal');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });
});

describe('sign / unsign', () => {
  it('round-trips a payload and rejects tampering', () => {
    const signed = sign(SECRET, JSON.stringify({ state: 'a', verifier: 'b' }));
    expect(JSON.parse(unsign(SECRET, signed)!)).toEqual({ state: 'a', verifier: 'b' });
    expect(unsign('other-secret', signed)).toBeNull();
    expect(unsign(SECRET, signed.slice(0, -2) + 'xy')).toBeNull();
    expect(unsign(SECRET, undefined)).toBeNull();
    expect(unsign(SECRET, 'nodot')).toBeNull();
  });
});

describe('cookies', () => {
  it('parses a Cookie header and finds the session token', () => {
    const header = 'a=1; fd_session=the.jwt.value; b=2';
    expect(parseCookies(header)).toMatchObject({ a: '1', fd_session: 'the.jwt.value', b: '2' });
    expect(sessionToken(header)).toBe('the.jwt.value');
    expect(sessionToken(undefined)).toBeUndefined();
  });

  it('serializes a Set-Cookie with the expected attributes', () => {
    const c = cookie('fd_session', 'v', { maxAge: 100, secure: true });
    expect(c).toContain('fd_session=v');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Secure');
    expect(c).toContain('Max-Age=100');
    expect(cookie('x', 'y')).not.toContain('Secure');
  });
});

describe('randomState', () => {
  it('is non-empty and unique', () => {
    expect(randomState().length).toBeGreaterThan(0);
    expect(randomState()).not.toBe(randomState());
  });
});
