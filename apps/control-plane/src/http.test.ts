import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AuditLog } from './audit.js';
import { CommandBus } from './commands.js';
import type { Config } from './config.js';
import type { Context } from './context.js';
import { DeployStore } from './deploys.js';
import { createHttpApp } from './http.js';
import { Metrics } from './metrics.js';
import { Store } from './store.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
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
    actionTimeoutMs: 20_000,
    auditMax: 500,
    auditFile: '',
    dbFile: ':memory:',
    githubWebhookSecret: '',
    ...overrides,
  };
}

function makeContext(config = makeConfig()): Context {
  return {
    config,
    store: new Store(10),
    commands: new CommandBus(1000),
    audit: new AuditLog(50),
    metrics: new Metrics(),
    deploys: new DeployStore(),
  };
}

describe('http api', () => {
  it('serves health when open (no dashboard token)', async () => {
    const app = createHttpApp(makeContext(), () => 0);
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('requires the dashboard token when configured', async () => {
    const app = createHttpApp(makeContext(makeConfig({ dashboardToken: 'dash-secret' })), () => 0);

    const denied = await app.request('/api/health');
    expect(denied.status).toBe(401);

    const allowed = await app.request('/api/health', {
      headers: { Authorization: 'Bearer dash-secret' },
    });
    expect(allowed.status).toBe(200);
  });

  it('reflects the configured CORS origin', async () => {
    const app = createHttpApp(makeContext(), () => 0);
    const res = await app.request('/api/services', {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('404s an unknown service', async () => {
    const app = createHttpApp(makeContext(), () => 0);
    const res = await app.request('/api/services/ghost');
    expect(res.status).toBe(404);
  });

  it('serves Prometheus metrics without auth, even when a dashboard token is set', async () => {
    const ctx = makeContext(makeConfig({ dashboardToken: 'dash-secret' }));
    ctx.metrics.incAction('restart', true);
    const app = createHttpApp(ctx, () => 2);
    const res = await app.request('/metrics');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('flightdeck_agents_connected 2');
    expect(body).toContain('flightdeck_actions_total{action="restart",outcome="ok"} 1');
  });

  it('serves the audit trail', async () => {
    const ctx = makeContext();
    ctx.audit.record({ ts: 1, action: 'restart', serviceId: 'api', actor: '1.2.3.4', ok: true });
    const app = createHttpApp(ctx, () => 0);
    const res = await app.request('/api/audit');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { audit: Array<{ serviceId: string }> };
    expect(body.audit[0]?.serviceId).toBe('api');
  });

  it('ingests a signed GitHub workflow_run webhook and rejects a bad signature', async () => {
    const ctx = makeContext(makeConfig({ githubWebhookSecret: 'whsec' }));
    const app = createHttpApp(ctx, () => 0);
    const payload = JSON.stringify({
      repository: { full_name: 'acme/api' },
      workflow_run: { id: 7, head_sha: 'deadbeef', status: 'completed', conclusion: 'success' },
    });
    const sig = 'sha256=' + createHmac('sha256', 'whsec').update(payload).digest('hex');

    const ok = await app.request('/github/webhook', {
      method: 'POST',
      headers: { 'x-github-event': 'workflow_run', 'x-hub-signature-256': sig },
      body: payload,
    });
    expect(ok.status).toBe(200);

    const list = (await (await app.request('/api/deploys')).json()) as {
      deploys: Array<{ repo: string; status: string }>;
    };
    expect(list.deploys[0]).toMatchObject({ repo: 'acme/api', status: 'success' });

    const bad = await app.request('/github/webhook', {
      method: 'POST',
      headers: { 'x-github-event': 'workflow_run', 'x-hub-signature-256': 'sha256=00' },
      body: payload,
    });
    expect(bad.status).toBe(401);
  });
});
