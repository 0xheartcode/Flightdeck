import { describe, expect, it } from 'vitest';
import type { Config } from './config.js';
import { authorizeUpgrade, originOk } from './authorize.js';

const base: Config = {
  host: '0.0.0.0',
  port: 4000,
  agentToken: 'agent-secret',
  dashboardToken: '',
  corsOrigin: 'http://localhost:5173',
  logBufferSize: 2000,
  maxPayloadBytes: 262_144,
  maxServices: 1000,
};

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
  it('accepts the correct agent token in the header', () => {
    expect(authorizeUpgrade({ pathname: '/agent', headerToken: 'agent-secret' }, base)).toEqual({
      ok: true,
      status: 101,
    });
  });

  it('rejects a wrong or missing agent token with 401', () => {
    expect(authorizeUpgrade({ pathname: '/agent', headerToken: 'nope' }, base).status).toBe(401);
    expect(authorizeUpgrade({ pathname: '/agent' }, base).status).toBe(401);
  });

  it('ignores a token supplied only in the query for /agent', () => {
    expect(authorizeUpgrade({ pathname: '/agent', queryToken: 'agent-secret' }, base).ok).toBe(
      false,
    );
  });
});

describe('authorizeUpgrade /stream', () => {
  it('is open when no dashboard token is configured but still enforces origin', () => {
    expect(authorizeUpgrade({ pathname: '/stream', origin: base.corsOrigin }, base).ok).toBe(true);
    expect(
      authorizeUpgrade({ pathname: '/stream', origin: 'http://evil.example' }, base).status,
    ).toBe(403);
  });

  it('requires the dashboard token (header or query) when configured', () => {
    const cfg = { ...base, dashboardToken: 'dash-secret' };
    expect(authorizeUpgrade({ pathname: '/stream', origin: base.corsOrigin }, cfg).status).toBe(
      401,
    );
    expect(
      authorizeUpgrade(
        { pathname: '/stream', origin: base.corsOrigin, queryToken: 'dash-secret' },
        cfg,
      ).ok,
    ).toBe(true);
    expect(
      authorizeUpgrade(
        { pathname: '/stream', origin: base.corsOrigin, headerToken: 'dash-secret' },
        cfg,
      ).ok,
    ).toBe(true);
  });

  it('checks origin before the token', () => {
    const cfg = { ...base, dashboardToken: 'dash-secret' };
    expect(
      authorizeUpgrade(
        { pathname: '/stream', origin: 'http://evil.example', queryToken: 'dash-secret' },
        cfg,
      ).status,
    ).toBe(403);
  });
});

describe('authorizeUpgrade unknown path', () => {
  it('returns 404', () => {
    expect(authorizeUpgrade({ pathname: '/nope' }, base).status).toBe(404);
  });
});
