import { createHmac } from 'node:crypto';
import type { Config } from './config.js';

/** A full, valid Config for tests. Override only what a case cares about. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    host: '127.0.0.1',
    port: 0,
    agentToken: 'test-token',
    agentTokens: '',
    agentTokensFile: '',
    dashboardToken: '',
    corsOrigin: '*',
    logBufferSize: 100,
    maxPayloadBytes: 262_144,
    maxServices: 100,
    actionsEnabled: true,
    actionTimeoutMs: 2000,
    auditMax: 50,
    auditFile: '',
    dbFile: ':memory:',
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
    ...overrides,
  };
}

/** Mint an HS256 JWT for tests. Pass claims (sub, roles, exp, iss, aud, ...). */
export function mintHs256(claims: Record<string, unknown>, secret: string): string {
  const seg = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = seg({ alg: 'HS256', typ: 'JWT' });
  const payload = seg(claims);
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}
