import { randomUUID } from 'node:crypto';
import type { AuditLog } from '../audit.js';
import { logger } from '../logger.js';
import { realSend, type SendFn } from './senders.js';
import type { TransmitterStore } from './store.js';
import {
  SEVERITY_RANK,
  type Channel,
  type Delivery,
  type Signal,
  type SignalInput,
} from './types.js';

const log = logger.child({ component: 'transmitter' });

export interface TransmitterOptions {
  send?: SendFn;
  now?: () => number;
  /** Retry backoff in ms per attempt (length = max attempts). */
  backoff?: number[];
}

/**
 * The Transmitter service: turns incoming signals into deliveries by matching
 * routes and fanning out to channels, with throttling, quiet hours, mute,
 * retries and auditing. The send function is injectable so tests use a mock sink
 * and never make real network calls.
 */
export class TransmitterService {
  private readonly send: SendFn;
  private readonly now: () => number;
  private readonly backoff: number[];
  /** Per-route send timestamps for throttle windows. */
  private readonly throttleHits = new Map<string, number[]>();

  constructor(
    private readonly store: TransmitterStore,
    private readonly audit: AuditLog,
    opts: TransmitterOptions = {},
  ) {
    this.send = opts.send ?? realSend;
    this.now = opts.now ?? Date.now;
    this.backoff = opts.backoff ?? [0, 250, 1000];
  }

  /** Record an inbound signal and dispatch it. Used by /ingest and internal producers. */
  async emit(source: string, input: SignalInput): Promise<Signal> {
    const signal = this.store.addSignal({
      ts: this.now(),
      severity: input.severity,
      title: input.title,
      body: input.body,
      source,
    });
    await this.dispatch(signal, input.eventType, input.project);
    return signal;
  }

  /** Send a one-off test to a single channel, bypassing routes. */
  async testChannel(channelId: string): Promise<Delivery> {
    const channel = this.store.getChannel(channelId);
    if (!channel) throw new Error('channel not found');
    const signal: Signal = {
      id: `test_${randomUUID().slice(0, 8)}`,
      ts: this.now(),
      severity: 'info',
      title: 'Test notification',
      body: 'This is a test from Flightdeck Transmitter.',
      source: 'src_builtin',
      read: true,
    };
    return this.deliver(channel, signal, undefined);
  }

  private within(time: string, start: string, end: string): boolean {
    // HH:MM comparison; a window that wraps midnight (start > end) is handled.
    if (start <= end) return time >= start && time < end;
    return time >= start || time < end;
  }

  private hhmm(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  private throttled(routeId: string, perMin: number): boolean {
    const now = this.now();
    const hits = (this.throttleHits.get(routeId) ?? []).filter((t) => now - t < 60_000);
    if (hits.length >= perMin) {
      this.throttleHits.set(routeId, hits);
      return true;
    }
    hits.push(now);
    this.throttleHits.set(routeId, hits);
    return false;
  }

  private async dispatch(signal: Signal, eventType?: string, project?: string): Promise<void> {
    // Global mute: the signal is still recorded in the inbox (done by emit),
    // but no channel receives a delivery until the mute window passes.
    const muteUntil = this.store.getMuteUntil();
    if (muteUntil && this.now() < muteUntil) return;

    const targets = new Map<string, string>(); // channelId -> routeId (first match wins)
    for (const route of this.store.listRoutes()) {
      if (route.muted) continue;
      if (SEVERITY_RANK[signal.severity] < SEVERITY_RANK[route.match.minSeverity]) continue;
      if (
        route.match.eventTypes.length &&
        (!eventType || !route.match.eventTypes.includes(eventType))
      )
        continue;
      if (route.match.projects.length && (!project || !route.match.projects.includes(project)))
        continue;
      if (
        route.quietHours &&
        this.within(this.hhmm(this.now()), route.quietHours.start, route.quietHours.end)
      )
        continue;
      if (route.throttlePerMin && this.throttled(route.id, route.throttlePerMin)) continue;
      for (const cid of route.channelIds) if (!targets.has(cid)) targets.set(cid, route.id);
    }

    for (const [channelId, routeId] of targets) {
      const channel = this.store.getChannel(channelId);
      if (!channel || !channel.enabled) continue;
      await this.deliver(channel, signal, routeId);
    }
  }

  private async deliver(
    channel: Channel,
    signal: Signal,
    routeId: string | undefined,
  ): Promise<Delivery> {
    const credential = this.store.getChannelCredential(channel.id);
    let lastErr: string | undefined;
    for (let attempt = 0; attempt < this.backoff.length; attempt++) {
      if (attempt > 0) await sleep(this.backoff[attempt] ?? 0);
      try {
        await this.send(channel, credential, signal);
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = (err as Error).message;
      }
    }
    const delivery: Delivery = {
      id: `dl_${randomUUID().slice(0, 8)}`,
      ts: this.now(),
      channelId: channel.id,
      channelName: channel.name,
      routeId,
      signalTitle: signal.title,
      ok: lastErr === undefined,
      error: lastErr,
    };
    this.store.addDelivery(delivery);
    if (!delivery.ok) log.warn({ channel: channel.id, error: lastErr }, 'delivery failed');
    return delivery;
  }
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}
