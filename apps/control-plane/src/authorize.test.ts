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
  actionsEnabled: false,
  transmitterEnabled: false,
  transmitterDbFile: ':memory:',
  localUsersEnabled: false,
  localUsersDbFile: ':memory:',
  bootstrapAdmin: '',
  agentTokenStoreEnabled: false,
  agentTokensDbFile: ':memory:',
  actionTimeoutMs: 20_000,
  auditMax: 500,
  auditFile: '',
  dbFile: ':memory:',
  databaseUrl: '',
  githubWebhookSecret: '',
  maxConnections: 1000,
  actionRatePerMin: 30,
  oidcIssuer: '',
  oidcAudience: '',
  oidcHs256Secret: '',
  oidcRs256PublicKey: '',
  oidcJwksUri: '',
  oidcRolesClaim: 'roles',
  operatorRoles: [],
  adminRoles: [],
  oidcClientId: '',
  oidcClientSecret: '',
  oidcAuthEndpoint: '',
  oidcTokenEndpoint: '',
  oidcRedirectUri: '',
  oidcScopes: 'openid profile email',
  sessionSecret: '',
  webAppUrl: 'http://localhost:5173',
  lokiUrl: '',
  lokiTenant: '',
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

  it('requires a valid JWT and returns the principal when identity is enabled', () => {
    const cfg = { ...base, oidcHs256Secret: 'secret' };
    const principal = { subject: 'u1', roles: ['operator'] };
    const verifyClient = (token: string | undefined) => (token === 'good' ? principal : null);

    const ok = authorizeUpgrade(
      { pathname: '/stream', origin: base.corsOrigin, queryToken: 'good' },
      cfg,
      verify,
      verifyClient,
    );
    expect(ok.ok).toBe(true);
    expect(ok.principal).toEqual(principal);

    expect(
      authorizeUpgrade(
        { pathname: '/stream', origin: base.corsOrigin, queryToken: 'bad' },
        cfg,
        verify,
        verifyClient,
      ).status,
    ).toBe(401);

    // With identity on, the dashboard token path is not consulted: no token, 401.
    expect(
      authorizeUpgrade({ pathname: '/stream', origin: base.corsOrigin }, cfg, verify, verifyClient)
        .status,
    ).toBe(401);
  });
});

describe('authorizeUpgrade /stream with local users', () => {
  it('accepts a local session and resolves its permissions from the roles', () => {
    const cfg = { ...base, localUsersEnabled: true };
    const admin = authorizeUpgrade(
      {
        pathname: '/stream',
        origin: base.corsOrigin,
        localPrincipal: { subject: 'u1', name: 'admin', roles: ['admin'] },
      },
      cfg,
      verify,
    );
    expect(admin.ok).toBe(true);
    expect(admin.principal?.name).toBe('admin');
    expect([...(admin.perms ?? [])].sort()).toEqual(['act', 'reveal', 'view']);

    const viewer = authorizeUpgrade(
      {
        pathname: '/stream',
        origin: base.corsOrigin,
        localPrincipal: { subject: 'u2', name: 'viewer', roles: ['viewer'] },
      },
      cfg,
      verify,
    );
    expect([...(viewer.perms ?? [])]).toEqual(['view']);
  });

  it('rejects a stream with no local session when local users are enabled', () => {
    const cfg = { ...base, localUsersEnabled: true };
    expect(
      authorizeUpgrade({ pathname: '/stream', origin: base.corsOrigin }, cfg, verify).status,
    ).toBe(401);
  });

  it('allows the dashboard token as a service fallback with full permissions', () => {
    const cfg = { ...base, localUsersEnabled: true, dashboardToken: 'dash-secret' };
    const ok = authorizeUpgrade(
      { pathname: '/stream', origin: base.corsOrigin, headerToken: 'dash-secret' },
      cfg,
      verify,
    );
    expect(ok.ok).toBe(true);
    expect([...(ok.perms ?? [])].sort()).toEqual(['act', 'reveal', 'view']);
  });
});

describe('authorizeUpgrade unknown path', () => {
  it('returns 404', () => {
    expect(authorizeUpgrade({ pathname: '/nope' }, base, verify).status).toBe(404);
  });
});
