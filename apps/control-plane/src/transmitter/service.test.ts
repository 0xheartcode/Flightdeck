import { describe, expect, it, vi } from 'vitest';
import { AuditLog } from '../audit.js';
import { TransmitterService } from './service.js';
import { TransmitterStore } from './store.js';
import type { SendFn } from './senders.js';
import type { Channel, Signal } from './types.js';

interface Harness {
  store: TransmitterStore;
  service: TransmitterService;
  sent: Array<{ channel: Channel; credential?: string; signal: Signal }>;
}

function harness(opts: { send?: SendFn; now?: () => number } = {}): Harness {
  const store = new TransmitterStore();
  const sent: Harness['sent'] = [];
  const send: SendFn =
    opts.send ??
    ((channel, credential, signal) => {
      sent.push({ channel, credential, signal });
      return Promise.resolve();
    });
  const service = new TransmitterService(store, new AuditLog(10), {
    send,
    now: opts.now,
    backoff: [0, 0, 0],
  });
  return { store, service, sent };
}

function route(
  store: TransmitterStore,
  over: Partial<Parameters<TransmitterStore['createRoute']>[0]> = {},
) {
  const ch = store.createChannel({
    kind: 'slack',
    name: 'ch',
    config: { url: 'https://x' },
    enabled: true,
    credential: 'k',
  });
  return store.createRoute({
    name: 'r',
    match: { eventTypes: [], minSeverity: 'warning', projects: [], ...over.match },
    channelIds: [ch.id],
    muted: false,
    ...over,
  });
}

describe('TransmitterService dispatch', () => {
  it('delivers a matching signal to the route channel with its credential', async () => {
    const h = harness();
    route(h.store);
    await h.service.emit('src_builtin', { severity: 'error', title: 'boom' });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.credential).toBe('k');
    expect(h.store.listDeliveries()[0]?.ok).toBe(true);
  });

  it('ignores signals below the route minimum severity', async () => {
    const h = harness();
    route(h.store, { match: { eventTypes: [], minSeverity: 'error', projects: [] } });
    await h.service.emit('src_builtin', { severity: 'warning', title: 'meh' });
    expect(h.sent).toHaveLength(0);
  });

  it('filters by event type and project', async () => {
    const h = harness();
    route(h.store, {
      match: { eventTypes: ['deploy'], minSeverity: 'info', projects: ['acme/web'] },
    });
    await h.service.emit('src_builtin', {
      severity: 'info',
      title: 'x',
      eventType: 'other',
      project: 'acme/web',
    });
    await h.service.emit('src_builtin', {
      severity: 'info',
      title: 'y',
      eventType: 'deploy',
      project: 'acme/web',
    });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.signal.title).toBe('y');
  });

  it('does not send through a muted route', async () => {
    const h = harness();
    route(h.store, { muted: true });
    await h.service.emit('src_builtin', { severity: 'critical', title: 'x' });
    expect(h.sent).toHaveLength(0);
  });

  it('throttles once the per-minute limit is hit', async () => {
    const h = harness();
    route(h.store, { throttlePerMin: 1 });
    await h.service.emit('src_builtin', { severity: 'error', title: 'a' });
    await h.service.emit('src_builtin', { severity: 'error', title: 'b' });
    expect(h.sent).toHaveLength(1);
  });

  it('suppresses during quiet hours', async () => {
    // Fix "now" to 02:30 local and set a 00:00-06:00 quiet window.
    const at0230 = new Date(2020, 0, 1, 2, 30, 0).getTime();
    const h = harness({ now: () => at0230 });
    route(h.store, { quietHours: { start: '00:00', end: '06:00' } });
    await h.service.emit('src_builtin', { severity: 'critical', title: 'x' });
    expect(h.sent).toHaveLength(0);
  });

  it('retries then records a failed delivery when the sender keeps throwing', async () => {
    const send = vi.fn<SendFn>(() => Promise.reject(new Error('HTTP 500')));
    const h = harness({ send });
    route(h.store);
    await h.service.emit('src_builtin', { severity: 'error', title: 'x' });
    expect(send).toHaveBeenCalledTimes(3); // backoff length
    const d = h.store.listDeliveries()[0];
    expect(d?.ok).toBe(false);
    expect(d?.error).toContain('HTTP 500');
  });

  it('testChannel delivers directly, bypassing routes', async () => {
    const h = harness();
    const ch = h.store.createChannel({
      kind: 'slack',
      name: 'direct',
      config: { url: 'https://x' },
      enabled: true,
      credential: 'k',
    });
    const delivery = await h.service.testChannel(ch.id);
    expect(delivery.ok).toBe(true);
    expect(h.sent).toHaveLength(1);
  });
});
