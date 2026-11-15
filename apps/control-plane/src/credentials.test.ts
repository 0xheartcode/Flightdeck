import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from './config.js';
import { CredentialStore, parseEntries } from './credentials.js';

function config(overrides: Partial<Config> = {}): Config {
  return {
    host: '0.0.0.0',
    port: 4000,
    agentToken: '',
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
    ...overrides,
  };
}

describe('parseEntries', () => {
  it('parses name:token lines, skipping blanks and comments', () => {
    const creds = parseEntries('# agents\nedge-1: tok1\n\nedge-2:tok2\nbad-line\n');
    expect(creds).toEqual([
      { name: 'edge-1', token: 'tok1' },
      { name: 'edge-2', token: 'tok2' },
    ]);
  });
});

describe('CredentialStore', () => {
  it('falls back to the single shared token named "default"', () => {
    const store = new CredentialStore(config({ agentToken: 'solo' }));
    expect(store.verify('solo')).toBe('default');
    expect(store.verify('nope')).toBeNull();
    expect(store.verify(undefined)).toBeNull();
  });

  it('resolves inline per-agent tokens to their names', () => {
    const store = new CredentialStore(config({ agentTokens: 'a:tok-a, b:tok-b' }));
    expect(store.verify('tok-a')).toBe('a');
    expect(store.verify('tok-b')).toBe('b');
    expect(store.size).toBe(2);
  });

  it('fails closed with no credentials configured', () => {
    const store = new CredentialStore(config());
    expect(store.size).toBe(0);
    expect(store.verify('anything')).toBeNull();
  });
});

describe('CredentialStore revocation via file reload', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fd-creds-'));
    file = join(dir, 'agents');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('revokes a credential when its line is removed and reload() runs', () => {
    writeFileSync(file, 'edge-1:tok1\nedge-2:tok2\n');
    const store = new CredentialStore(config({ agentTokensFile: file }));
    expect(store.verify('tok1')).toBe('edge-1');
    expect(store.verify('tok2')).toBe('edge-2');

    // Revoke edge-1 by removing its line.
    writeFileSync(file, 'edge-2:tok2\n');
    store.reload();

    expect(store.verify('tok1')).toBeNull();
    expect(store.verify('tok2')).toBe('edge-2');
  });
});
