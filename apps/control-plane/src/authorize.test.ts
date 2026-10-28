import { describe, expect, it } from 'vitest';
import type { Config } from './config.js';
import { authorizeUpgrade, originOk, type VerifyAgent } from './authorize.js';

const base: Config = {
  host: '0.0.0.0',
  port: 4000,
  agentToken: 'agent-secret',
  agentTokens: '',
  agentTokensFile: '',
  dashboardToken: '',
  corsOrigin: 'http://localhost:5173',
  logBufferSize: 2000,
  maxPayloadBytes: 262_144,
  maxServices: 1000,
};

// Resolves the one known token to the agent name "edge-1".
const verify: VerifyAgent = (token) => (token === 'agent-secret' ? 'edge-1' : null);

describe('originOk', () => {
  it('allows the configured origin and rejects others', () => {
    expect(originOk('http://localhost:5173', 'http://localhost:5173')).toBe(true);
    expect(originOk('http://evil.example', 'http://localhost:5173')).toBe(false);
  });

  it('allows any origin only when configured as "*"', () => {
    expect(originOk('http://evil.example', '*')).toBe(true);
  });

  it('allows a missing origin (non-browser client)', () => {
    expect(originOk(undefined, 'http://localhost:5173')).toBe(true);
  });
});

describe('authorizeUpgrade /agent', () => {
  it('accepts a valid agent token and returns the resolved name', () => {
    expect(
      authorizeUpgrade({ pathname: '/agent', headerToken: 'agent-secret' }, base, verify),
    ).toEqual({ ok: true, status: 101, agentName: 'edge-1' });
  });

  it('rejects a wrong or missing agent token with 401', () => {
    expect(authorizeUpgrade({ pathname: '/agent', headerToken: 'nope' }, base, verify).status).toBe(
      401,
    );
    expect(authorizeUpgrade({ pathname: '/agent' }, base, verify).status).toBe(401);
  });

  it('ignores a token supplied only in the query for /agent', () => {
    expect(
      authorizeUpgrade({ pathname: '/agent', queryToken: 'agent-secret' }, base, verify).ok,
    ).toBe(false);
  });
});

describe('authorizeUpgrade /stream', () => {
  it('is open when no dashboard token is configured but still enforces origin', () => {
    expect(
      authorizeUpgrade({ pathname: '/stream', origin: base.corsOrigin }, base, verify).ok,
    ).toBe(true);
    expect(
      authorizeUpgrade({ pathname: '/stream', origin: 'http://evil.example' }, base, verify).status,
    ).toBe(403);
  });

  it('requires the dashboard token (header or query) when configured', () => {
    const cfg = { ...base, dashboardToken: 'dash-secret' };
    expect(
      authorizeUpgrade({ pathname: '/stream', origin: base.corsOrigin }, cfg, verify).status,
    ).toBe(401);
    expect(
      authorizeUpgrade(
        { pathname: '/stream', origin: base.corsOrigin, queryToken: 'dash-secret' },
        cfg,
        verify,
      ).ok,
    ).toBe(true);
    expect(
      authorizeUpgrade(
        { pathname: '/stream', origin: base.corsOrigin, headerToken: 'dash-secret' },
        cfg,
        verify,
      ).ok,
    ).toBe(true);
  });

  it('checks origin before the token', () => {
    const cfg = { ...base, dashboardToken: 'dash-secret' };
    expect(
      authorizeUpgrade(
        { pathname: '/stream', origin: 'http://evil.example', queryToken: 'dash-secret' },
        cfg,
        verify,
      ).status,
    ).toBe(403);
  });
});

describe('authorizeUpgrade unknown path', () => {
  it('returns 404', () => {
    expect(authorizeUpgrade({ pathname: '/nope' }, base, verify).status).toBe(404);
  });
});
