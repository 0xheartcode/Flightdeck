import { describe, expect, it } from 'vitest';
import type { Config } from './config.js';
import { createHttpApp } from './http.js';
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
    ...overrides,
  };
}

describe('http api', () => {
  it('serves health when open (no dashboard token)', async () => {
    const app = createHttpApp(new Store(10), makeConfig());
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('requires the dashboard token when configured', async () => {
    const app = createHttpApp(new Store(10), makeConfig({ dashboardToken: 'dash-secret' }));

    const denied = await app.request('/api/health');
    expect(denied.status).toBe(401);

    const allowed = await app.request('/api/health', {
      headers: { Authorization: 'Bearer dash-secret' },
    });
    expect(allowed.status).toBe(200);
  });

  it('reflects the configured CORS origin', async () => {
    const app = createHttpApp(new Store(10), makeConfig());
    const res = await app.request('/api/services', {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('404s an unknown service', async () => {
    const app = createHttpApp(new Store(10), makeConfig());
    const res = await app.request('/api/services/ghost');
    expect(res.status).toBe(404);
  });
});
