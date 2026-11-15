import { describe, expect, it } from 'vitest';
import { AuditLog } from '../audit.js';
import { nullBus } from '../bus.js';
import { CommandBus } from '../commands.js';
import { testConfig } from '../config.testutil.js';
import type { Context } from '../context.js';
import { SqliteDeployStore } from '../deploys.js';
import { createHttpApp } from '../http.js';
import { Metrics } from '../metrics.js';
import { Store } from '../store.js';
import { AgentTokenStore } from './store.js';

function makeApp(agentTokens: AgentTokenStore) {
  // Open mode (no identity, no dashboard token, no local users): the caller
  // holds all permissions, so admin-gated endpoints are reachable.
  const ctx: Context = {
    config: testConfig({ agentTokenStoreEnabled: true }),
    store: new Store(10),
    commands: new CommandBus(1000),
    audit: new AuditLog(50),
    metrics: new Metrics(),
    deploys: new SqliteDeployStore(),
    bus: nullBus,
    agentTokens,
  };
  return createHttpApp(ctx, () => 0);
}

describe('agent-tokens routes', () => {
  it('issues a token once, lists only the hint, and authenticates the issued secret', async () => {
    const store = new AgentTokenStore();
    const app = makeApp(store);

    const created = await app.request('/api/agent-tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'vega' }),
    });
    expect(created.status).toBe(201);
    const { secret, token } = (await created.json()) as {
      secret: string;
      token: { id: string; hint: string };
    };
    expect(secret).toBeTruthy();
    // The issued secret authenticates an agent immediately.
    expect(store.verify(secret)).toBe('vega');

    const list = await app.request('/api/agent-tokens');
    const body = await list.text();
    expect(body).toContain(token.hint);
    expect(body).not.toContain(secret);
  });

  it('revokes a token so it no longer authenticates', async () => {
    const store = new AgentTokenStore();
    const app = makeApp(store);
    const { token, secret } = store.create('vega');
    const res = await app.request(`/api/agent-tokens/${token.id}/revoke`, { method: 'POST' });
    expect(res.status).toBe(204);
    expect(store.verify(secret)).toBeNull();
  });

  it('rejects an invalid token name', async () => {
    const res = await makeApp(new AgentTokenStore()).request('/api/agent-tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'has spaces!' }),
    });
    expect(res.status).toBe(400);
  });
});
