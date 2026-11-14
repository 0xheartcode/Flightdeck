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
import { TransmitterService } from './service.js';
import { TransmitterStore } from './store.js';

/** A context with the Transmitter enabled and a send sink that never hits the network. */
function makeContext(): { ctx: Context; store: TransmitterStore } {
  const store = new TransmitterStore();
  const audit = new AuditLog(50);
  const service = new TransmitterService(store, audit, {
    send: () => Promise.resolve(),
    backoff: [0],
  });
  const ctx: Context = {
    config: testConfig(),
    store: new Store(10),
    commands: new CommandBus(1000),
    audit,
    metrics: new Metrics(),
    deploys: new SqliteDeployStore(),
    bus: nullBus,
    transmitter: { store, service },
  };
  return { ctx, store };
}

describe('transmitter routes', () => {
  it('never returns channel credentials over the API', async () => {
    const { ctx } = makeContext();
    const app = createHttpApp(ctx, () => 0);
    const create = await app.request('/api/transmitter/channels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'slack',
        name: 'alerts',
        config: { url: 'https://x' },
        enabled: true,
        credential: 'top-secret',
      }),
    });
    expect(create.status).toBe(201);
    const body = await create.text();
    expect(body).not.toContain('top-secret');
    expect(JSON.parse(body).channel.credentialSet).toBe(true);

    const list = await app.request('/api/transmitter/channels');
    expect(await list.text()).not.toContain('top-secret');
  });

  it('reports the backend in /api/me', async () => {
    const { ctx } = makeContext();
    const app = createHttpApp(ctx, () => 0);
    const me = (await (await app.request('/api/me')).json()) as { transmitter: boolean };
    expect(me.transmitter).toBe(true);
  });

  it('authenticates inbound ingest with the source token', async () => {
    const { ctx, store } = makeContext();
    const app = createHttpApp(ctx, () => 0);
    const { source, token } = store.createSource('ci');

    const bad = await app.request(`/transmitter/ingest/${source.id}`, {
      method: 'POST',
      headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' },
      body: JSON.stringify({ severity: 'error', title: 'x' }),
    });
    expect(bad.status).toBe(401);

    const ok = await app.request(`/transmitter/ingest/${source.id}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ severity: 'error', title: 'ingested' }),
    });
    expect(ok.status).toBe(202);
    expect(store.listSignals().some((s) => s.title === 'ingested')).toBe(true);
  });

  it('rejects an invalid ingest payload', async () => {
    const { ctx, store } = makeContext();
    const app = createHttpApp(ctx, () => 0);
    const { source, token } = store.createSource('ci');
    const res = await app.request(`/transmitter/ingest/${source.id}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ nope: true }),
    });
    expect(res.status).toBe(400);
  });
});
