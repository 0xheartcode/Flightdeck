import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type {
  CommandAction,
  DeployRecord,
  EnvVar,
  LogLine,
  ServiceInfo,
  ServiceState,
  Stats,
} from '@flightdeck/protocol';
import type { Config } from './config.js';
import { logger } from './logger.js';

const { Client } = pg;
const log = logger.child({ component: 'bus' });
const CHANNEL = 'flightdeck_bus';
// Postgres NOTIFY payloads are capped at 8000 bytes; stay under it.
const MAX_PAYLOAD = 7900;

/**
 * Inter-instance bus for high-availability fan-out. Each control-plane instance
 * holds its own agents' live state in memory; the bus mirrors every live event
 * (service list, status, logs, stats, deploys) and routes commands across
 * instances, so a browser on any instance sees the whole fleet and can act on
 * any service. Built on Postgres LISTEN/NOTIFY (the same database used for the
 * HA deploy store), so it needs no extra infrastructure. Single-instance
 * deployments get the no-op bus.
 */
export type BusMessage =
  | { kind: 'service'; service: ServiceInfo }
  | { kind: 'service_gone'; serviceId: string }
  | { kind: 'status'; serviceId: string; state: ServiceState; exitCode?: number; ts: number }
  | { kind: 'log'; log: LogLine }
  | { kind: 'stats'; stats: Stats }
  | { kind: 'deploy'; serviceId: string; deploy: DeployRecord }
  | {
      kind: 'command';
      id: string;
      serviceId: string;
      action: CommandAction;
      containerId: string;
      env?: EnvVar[];
    }
  | { kind: 'command_result'; id: string; ok: boolean; error?: string };

export interface Bus {
  /** True for a real multi-instance bus, false for the single-instance no-op. */
  readonly distributed: boolean;
  /** Publish an event to the other instances. Best-effort. */
  publish(msg: BusMessage): void;
  /** Register the handler for messages from OTHER instances. */
  onMessage(handler: (msg: BusMessage) => void): void;
  start(): void;
  close(): Promise<void>;
}

/** No-op bus for a single instance. */
export const nullBus: Bus = {
  distributed: false,
  publish() {},
  onMessage() {},
  start() {},
  close() {
    return Promise.resolve();
  },
};

/** Postgres bus when a database is configured, else the no-op bus. */
export function createBus(config: Config): Bus {
  return config.databaseUrl ? new PgBus(config.databaseUrl) : nullBus;
}

export class PgBus implements Bus {
  readonly distributed = true;
  private readonly origin = randomUUID();
  private client: pg.Client | undefined;
  private handler: (msg: BusMessage) => void = () => {};
  private closed = false;

  constructor(private readonly connectionString: string) {}

  onMessage(handler: (msg: BusMessage) => void): void {
    this.handler = handler;
  }

  start(): void {
    void this.connect();
  }

  private async connect(): Promise<void> {
    if (this.closed) return;
    const client = new Client({ connectionString: this.connectionString });
    client.on('notification', (n) => {
      if (!n.payload) return;
      try {
        const env = JSON.parse(n.payload) as { origin: string; msg: BusMessage };
        if (env.origin === this.origin) return; // ignore our own events
        this.handler(env.msg);
      } catch {
        // ignore a malformed payload
      }
    });
    client.on('error', (err: Error) => {
      log.warn({ err: err.message }, 'bus connection error; reconnecting');
      this.client = undefined;
      if (!this.closed) setTimeout(() => void this.connect(), 1000);
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      this.client = client;
      log.info('bus connected (postgres LISTEN/NOTIFY)');
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'bus connect failed; retrying');
      if (!this.closed) setTimeout(() => void this.connect(), 1000);
    }
  }

  publish(msg: BusMessage): void {
    const client = this.client;
    if (!client) return; // not connected yet; best-effort
    let payload = JSON.stringify({ origin: this.origin, msg });
    if (payload.length > MAX_PAYLOAD) {
      // Only a log line can plausibly be this large; trim it for the bus.
      if (msg.kind === 'log') {
        const trimmed: BusMessage = {
          kind: 'log',
          log: { ...msg.log, line: msg.log.line.slice(0, 2000) + '… [truncated for bus]' },
        };
        payload = JSON.stringify({ origin: this.origin, msg: trimmed });
      }
      if (payload.length > MAX_PAYLOAD) {
        log.warn({ kind: msg.kind, size: payload.length }, 'bus message too large; dropped');
        return;
      }
    }
    void client.query('SELECT pg_notify($1, $2)', [CHANNEL, payload]).catch((err: Error) => {
      log.warn({ err: err.message }, 'bus publish failed');
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    const client = this.client;
    this.client = undefined;
    if (client) {
      try {
        await client.end();
      } catch {
        // already gone
      }
    }
  }
}
