import type { Hono } from 'hono';
import { bearer } from '../auth.js';
import type { Context } from '../context.js';
import type { Permission, Principal } from '../identity.js';
import { logger } from '../logger.js';
import { ChannelInput, RouteInput, SignalInput, SourceInput } from './types.js';

const log = logger.child({ component: 'transmitter-audit' });

type Env = { Variables: { auth: { principal?: Principal; perms: Set<Permission> } } };

const INGEST_MAX_BYTES = 64 * 1024;
const INGEST_PER_MIN = 60;

/** Per-source sliding-window rate limiter for the inbound ingest endpoint. */
const ingestHits = new Map<string, number[]>();
function ingestRateLimited(sourceId: string): boolean {
  const now = Date.now();
  const hits = (ingestHits.get(sourceId) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= INGEST_PER_MIN) {
    ingestHits.set(sourceId, hits);
    return true;
  }
  hits.push(now);
  ingestHits.set(sourceId, hits);
  return false;
}

/**
 * Mount the Transmitter API. Admin endpoints live under /api/transmitter and are
 * gated by the shared /api auth middleware (reads need an authenticated caller;
 * writes need the `act` permission). The inbound /transmitter/ingest endpoint
 * lives OUTSIDE /api — like the GitHub webhook — and authenticates with the
 * per-source token, rate-limited and size-capped. Every admin mutation is
 * audited with secrets redacted.
 */
export function registerTransmitter(app: Hono<Env>, ctx: Context): void {
  const tx = ctx.transmitter;
  if (!tx) return;
  const { store, service } = tx;

  const actor = (c: { get: (k: 'auth') => { principal?: Principal } }): string =>
    c.get('auth').principal?.subject ?? 'dashboard';
  const canAct = (c: { get: (k: 'auth') => { perms: Set<Permission> } }): boolean =>
    c.get('auth').perms.has('act');
  const audit = (action: string, target: string, who: string, ok = true): void => {
    log.info({ action, target, actor: who, ok }, 'transmitter admin');
  };

  // --- signals ---
  app.get('/api/transmitter/signals', (c) => c.json({ signals: store.listSignals() }));
  app.post('/api/transmitter/signals/:id/read', (c) => {
    store.markRead(c.req.param('id'));
    return c.body(null, 204);
  });
  app.post('/api/transmitter/signals/read-all', (c) => {
    store.markAllRead();
    return c.body(null, 204);
  });

  // --- channels ---
  app.get('/api/transmitter/channels', (c) => c.json({ channels: store.listChannels() }));
  app.post('/api/transmitter/channels', async (c) => {
    if (!canAct(c)) return c.json({ error: 'forbidden' }, 403);
    const parsed = ChannelInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid channel' }, 400);
    const channel = store.createChannel(parsed.data);
    audit('channel.create', channel.id, actor(c));
    return c.json({ channel }, 201);
  });
  app.put('/api/transmitter/channels/:id', async (c) => {
    if (!canAct(c)) return c.json({ error: 'forbidden' }, 403);
    const parsed = ChannelInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid channel' }, 400);
    const channel = store.updateChannel(c.req.param('id'), parsed.data);
    if (!channel) return c.json({ error: 'not_found' }, 404);
    audit('channel.update', channel.id, actor(c));
    return c.json({ channel });
  });
  app.delete('/api/transmitter/channels/:id', (c) => {
    if (!canAct(c)) return c.json({ error: 'forbidden' }, 403);
    store.deleteChannel(c.req.param('id'));
    audit('channel.delete', c.req.param('id'), actor(c));
    return c.body(null, 204);
  });
  app.post('/api/transmitter/channels/:id/test', async (c) => {
    if (!canAct(c)) return c.json({ error: 'forbidden' }, 403);
    try {
      const delivery = await service.testChannel(c.req.param('id'));
      audit('channel.test', c.req.param('id'), actor(c), delivery.ok);
      return c.json(delivery);
    } catch {
      return c.json({ error: 'not_found' }, 404);
    }
  });

  // --- routes ---
  app.get('/api/transmitter/routes', (c) => c.json({ routes: store.listRoutes() }));
  app.post('/api/transmitter/routes', async (c) => {
    if (!canAct(c)) return c.json({ error: 'forbidden' }, 403);
    const parsed = RouteInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid route' }, 400);
    const route = store.createRoute(parsed.data);
    audit('route.create', route.id, actor(c));
    return c.json({ route }, 201);
  });
  app.put('/api/transmitter/routes/:id', async (c) => {
    if (!canAct(c)) return c.json({ error: 'forbidden' }, 403);
    const parsed = RouteInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid route' }, 400);
    const route = store.updateRoute(c.req.param('id'), parsed.data);
    if (!route) return c.json({ error: 'not_found' }, 404);
    audit('route.update', route.id, actor(c));
    return c.json({ route });
  });
  app.delete('/api/transmitter/routes/:id', (c) => {
    if (!canAct(c)) return c.json({ error: 'forbidden' }, 403);
    store.deleteRoute(c.req.param('id'));
    audit('route.delete', c.req.param('id'), actor(c));
    return c.body(null, 204);
  });

  // --- sources ---
  app.get('/api/transmitter/sources', (c) => c.json({ sources: store.listSources() }));
  app.post('/api/transmitter/sources', async (c) => {
    if (!canAct(c)) return c.json({ error: 'forbidden' }, 403);
    const parsed = SourceInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid source' }, 400);
    const secret = store.createSource(parsed.data.name);
    audit('source.create', secret.source.id, actor(c));
    return c.json(secret, 201);
  });
  app.post('/api/transmitter/sources/:id/rotate', (c) => {
    if (!canAct(c)) return c.json({ error: 'forbidden' }, 403);
    const secret = store.rotateToken(c.req.param('id'));
    if (!secret) return c.json({ error: 'not_found' }, 404);
    audit('source.rotate', secret.source.id, actor(c));
    return c.json(secret);
  });
  app.delete('/api/transmitter/sources/:id', (c) => {
    if (!canAct(c)) return c.json({ error: 'forbidden' }, 403);
    store.revokeSource(c.req.param('id'));
    audit('source.revoke', c.req.param('id'), actor(c));
    return c.body(null, 204);
  });

  // --- deliveries ---
  app.get('/api/transmitter/deliveries', (c) => c.json({ deliveries: store.listDeliveries() }));

  // --- inbound ingest (outside /api; self-authenticated by the source token) ---
  app.post('/transmitter/ingest/:sourceId', async (c) => {
    const sourceId = c.req.param('sourceId');
    const token = bearer(c.req.header('authorization'));
    if (!token || !store.verifySourceToken(sourceId, token)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    if (ingestRateLimited(sourceId)) return c.json({ error: 'rate_limited' }, 429);
    const raw = await c.req.text();
    if (raw.length > INGEST_MAX_BYTES) return c.json({ error: 'payload too large' }, 413);
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return c.json({ error: 'invalid json' }, 400);
    }
    const parsed = SignalInput.safeParse(json);
    if (!parsed.success) return c.json({ error: 'invalid signal' }, 400);
    const signal = await service.emit(sourceId, parsed.data);
    return c.json({ ok: true, id: signal.id }, 202);
  });
}
