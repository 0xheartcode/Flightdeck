import type { LogLine } from '@flightdeck/protocol';
import type { Config } from './config.js';
import { logger } from './logger.js';

const log = logger.child({ component: 'loki' });

/** True when a Loki URL is configured. */
export function lokiEnabled(config: Config): boolean {
  return Boolean(config.lokiUrl);
}

/** A log line returned from a Loki search, newest-last. */
export interface SearchLine {
  ts: number;
  stream: string;
  line: string;
}

/** Build the LogQL selector plus optional line filter for a service. */
export function buildLogQL(serviceId: string, query: string | undefined): string {
  const selector = `{service=${JSON.stringify(serviceId)},job="flightdeck"}`;
  return query ? `${selector} |= ${JSON.stringify(query)}` : selector;
}

const msToNs = (ms: number): string => `${ms}000000`;

/**
 * Ships logs to Loki for durable storage and search. Pushes are batched and
 * flushed on a timer; a failed push is logged and dropped, since the in-memory
 * tail is the authoritative live view and Loki is the durable archive. Search
 * runs LogQL range queries against the same instance.
 */
export class LokiClient {
  private batch: LogLine[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly url: string,
    private readonly tenant: string,
    private readonly flushMs = 2000,
    private readonly maxBatch = 500,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (this.tenant) h['X-Scope-OrgID'] = this.tenant;
    return h;
  }

  /** Queue a log line for the next flush (flushes immediately when the batch is full). */
  push(line: LogLine): void {
    this.batch.push(line);
    if (this.batch.length >= this.maxBatch) void this.flush();
  }

  /** Send the queued lines to Loki, grouped into streams by service and source. */
  async flush(): Promise<void> {
    if (this.batch.length === 0) return;
    const pending = this.batch;
    this.batch = [];
    const streams = new Map<
      string,
      { labels: Record<string, string>; values: [string, string][] }
    >();
    for (const e of pending) {
      const key = `${e.serviceId}\u0000${e.stream}`;
      let s = streams.get(key);
      if (!s) {
        s = { labels: { service: e.serviceId, stream: e.stream, job: 'flightdeck' }, values: [] };
        streams.set(key, s);
      }
      s.values.push([msToNs(e.ts), e.line]);
    }
    const body = JSON.stringify({
      streams: [...streams.values()].map((s) => ({ stream: s.labels, values: s.values })),
    });
    try {
      const res = await fetch(`${this.url}/loki/api/v1/push`, {
        method: 'POST',
        headers: this.headers(),
        body,
      });
      if (!res.ok) log.warn({ status: res.status }, 'loki push rejected');
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'loki push failed');
    }
  }

  /** Search a service's logs over a time window, optionally filtering by text. */
  async search(
    serviceId: string,
    query: string | undefined,
    fromMs: number,
    toMs: number,
    limit = 200,
  ): Promise<SearchLine[]> {
    const u = new URL(`${this.url}/loki/api/v1/query_range`);
    u.searchParams.set('query', buildLogQL(serviceId, query));
    u.searchParams.set('start', msToNs(fromMs));
    u.searchParams.set('end', msToNs(toMs));
    u.searchParams.set('limit', String(limit));
    u.searchParams.set('direction', 'backward');
    try {
      const res = await fetch(u, { headers: this.headers() });
      if (!res.ok) return [];
      const json = (await res.json()) as {
        data?: { result?: Array<{ stream?: Record<string, string>; values?: [string, string][] }> };
      };
      const lines: SearchLine[] = [];
      for (const r of json.data?.result ?? []) {
        const stream = r.stream?.stream ?? 'stdout';
        for (const [tsNs, line] of r.values ?? []) {
          lines.push({ ts: Math.floor(Number(tsNs) / 1e6), stream, line });
        }
      }
      lines.sort((a, b) => a.ts - b.ts);
      return lines;
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'loki query failed');
      return [];
    }
  }

  /** Flush on a timer; returns a stop function that also does a final flush. */
  start(): () => void {
    this.timer = setInterval(() => void this.flush(), this.flushMs);
    this.timer.unref();
    return () => {
      if (this.timer) clearInterval(this.timer);
      void this.flush();
    };
  }
}
