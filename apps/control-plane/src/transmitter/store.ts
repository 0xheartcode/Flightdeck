import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  Channel,
  ChannelInput,
  Delivery,
  RouteInput,
  RouteRule,
  Signal,
  Source,
  SourceSecret,
} from './types.js';

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** True (1) / false (0) <-> boolean for SQLite integer columns. */
const bit = (b: boolean): number => (b ? 1 : 0);

/**
 * SQLite-backed Transmitter store. Default is in-memory; pass a file to persist.
 *
 * SECURITY:
 *  - Channel credentials live in the `credential` column and are returned ONLY
 *    via getChannelCredential(), used by the dispatcher. The public Channel
 *    serialisation (toChannel) never includes them.
 *  - Inbound source tokens are stored as a SHA-256 hash plus a 4-char hint; the
 *    plaintext is returned exactly once at create/rotate and never persisted.
 */
export class TransmitterStore {
  private readonly db: DatabaseSync;

  constructor(file: string = ':memory:') {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tx_channels (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL,
        config TEXT NOT NULL, enabled INTEGER NOT NULL,
        credential TEXT, credential_updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS tx_routes (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, match_json TEXT NOT NULL,
        channel_ids TEXT NOT NULL, throttle INTEGER, quiet TEXT, muted INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tx_sources (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, enabled INTEGER NOT NULL,
        token_hash TEXT, token_hint TEXT, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tx_signals (
        id TEXT PRIMARY KEY, ts INTEGER NOT NULL, severity TEXT NOT NULL,
        title TEXT NOT NULL, body TEXT, source TEXT NOT NULL, read INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tx_deliveries (
        id TEXT PRIMARY KEY, ts INTEGER NOT NULL, channel_id TEXT NOT NULL, channel_name TEXT NOT NULL,
        route_id TEXT, signal_title TEXT NOT NULL, ok INTEGER NOT NULL, error TEXT
      );
    `);
    // Seed the always-on builtin source once.
    const hasBuiltin = this.db.prepare('SELECT 1 FROM tx_sources WHERE kind = ?').get('builtin');
    if (!hasBuiltin) {
      this.db
        .prepare(
          'INSERT INTO tx_sources (id, kind, name, enabled, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run('src_builtin', 'builtin', 'Flightdeck events', 1, Date.now());
    }
  }

  // --- channels ---

  private toChannel(r: Record<string, unknown>): Channel {
    return {
      id: r.id as string,
      kind: r.kind as Channel['kind'],
      name: r.name as string,
      config: JSON.parse(r.config as string) as Record<string, string>,
      enabled: Boolean(r.enabled),
      credentialSet: Boolean(r.credential),
      credentialUpdatedAt: (r.credential_updated_at as number | null) ?? undefined,
    };
  }

  listChannels(): Channel[] {
    return this.db
      .prepare('SELECT * FROM tx_channels ORDER BY name')
      .all()
      .map((r) => this.toChannel(r));
  }
  getChannel(id: string): Channel | undefined {
    const r = this.db.prepare('SELECT * FROM tx_channels WHERE id = ?').get(id);
    return r ? this.toChannel(r) : undefined;
  }
  /** Dispatcher-only: the write-only secret. */
  getChannelCredential(id: string): string | undefined {
    const r = this.db.prepare('SELECT credential FROM tx_channels WHERE id = ?').get(id) as
      { credential: string | null } | undefined;
    return r?.credential ?? undefined;
  }
  createChannel(input: ChannelInput): Channel {
    const id = `ch_${randomUUID().slice(0, 8)}`;
    this.db
      .prepare(
        'INSERT INTO tx_channels (id, kind, name, config, enabled, credential, credential_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        input.kind,
        input.name,
        JSON.stringify(input.config),
        bit(input.enabled),
        input.credential ?? null,
        input.credential ? Date.now() : null,
      );
    return this.getChannel(id)!;
  }
  updateChannel(id: string, input: ChannelInput): Channel | undefined {
    const existing = this.getChannel(id);
    if (!existing) return undefined;
    const keepCred = input.credential === undefined;
    this.db
      .prepare(
        `UPDATE tx_channels SET name = ?, config = ?, enabled = ?${
          keepCred ? '' : ', credential = ?, credential_updated_at = ?'
        } WHERE id = ?`,
      )
      .run(
        ...(keepCred
          ? [input.name, JSON.stringify(input.config), bit(input.enabled), id]
          : [
              input.name,
              JSON.stringify(input.config),
              bit(input.enabled),
              input.credential!,
              Date.now(),
              id,
            ]),
      );
    return this.getChannel(id);
  }
  deleteChannel(id: string): void {
    this.db.prepare('DELETE FROM tx_channels WHERE id = ?').run(id);
    // Drop the channel from any route that referenced it.
    for (const r of this.listRoutes()) {
      if (r.channelIds.includes(id)) {
        this.updateRoute(r.id, { ...r, channelIds: r.channelIds.filter((c) => c !== id) });
      }
    }
  }

  // --- routes ---

  private toRoute(r: Record<string, unknown>): RouteRule {
    return {
      id: r.id as string,
      name: r.name as string,
      match: JSON.parse(r.match_json as string) as RouteRule['match'],
      channelIds: JSON.parse(r.channel_ids as string) as string[],
      throttlePerMin: (r.throttle as number | null) ?? undefined,
      quietHours: r.quiet ? (JSON.parse(r.quiet as string) as RouteRule['quietHours']) : undefined,
      muted: Boolean(r.muted),
    };
  }
  listRoutes(): RouteRule[] {
    return this.db
      .prepare('SELECT * FROM tx_routes ORDER BY name')
      .all()
      .map((r) => this.toRoute(r));
  }
  createRoute(input: RouteInput): RouteRule {
    const id = `rt_${randomUUID().slice(0, 8)}`;
    this.db
      .prepare(
        'INSERT INTO tx_routes (id, name, match_json, channel_ids, throttle, quiet, muted) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        input.name,
        JSON.stringify(input.match),
        JSON.stringify(input.channelIds),
        input.throttlePerMin ?? null,
        input.quietHours ? JSON.stringify(input.quietHours) : null,
        bit(input.muted),
      );
    return this.toRoute(
      this.db.prepare('SELECT * FROM tx_routes WHERE id = ?').get(id) as Record<string, unknown>,
    );
  }
  updateRoute(id: string, input: RouteInput): RouteRule | undefined {
    const row = this.db.prepare('SELECT 1 FROM tx_routes WHERE id = ?').get(id);
    if (!row) return undefined;
    this.db
      .prepare(
        'UPDATE tx_routes SET name = ?, match_json = ?, channel_ids = ?, throttle = ?, quiet = ?, muted = ? WHERE id = ?',
      )
      .run(
        input.name,
        JSON.stringify(input.match),
        JSON.stringify(input.channelIds),
        input.throttlePerMin ?? null,
        input.quietHours ? JSON.stringify(input.quietHours) : null,
        bit(input.muted),
        id,
      );
    return this.toRoute(
      this.db.prepare('SELECT * FROM tx_routes WHERE id = ?').get(id) as Record<string, unknown>,
    );
  }
  deleteRoute(id: string): void {
    this.db.prepare('DELETE FROM tx_routes WHERE id = ?').run(id);
  }

  // --- sources ---

  private toSource(r: Record<string, unknown>): Source {
    return {
      id: r.id as string,
      kind: r.kind as Source['kind'],
      name: r.name as string,
      enabled: Boolean(r.enabled),
      tokenHint: (r.token_hint as string | null) ?? undefined,
      createdAt: r.created_at as number,
    };
  }
  listSources(): Source[] {
    return this.db
      .prepare('SELECT * FROM tx_sources ORDER BY created_at')
      .all()
      .map((r) => this.toSource(r));
  }
  getSource(id: string): Source | undefined {
    const r = this.db.prepare('SELECT * FROM tx_sources WHERE id = ?').get(id);
    return r ? this.toSource(r) : undefined;
  }
  private freshToken(): { token: string; hash: string; hint: string } {
    const token = `fdwh_${randomBytes(24).toString('base64url')}`;
    return { token, hash: sha256(token), hint: token.slice(-4) };
  }
  createSource(name: string): SourceSecret {
    const id = `src_${randomUUID().slice(0, 8)}`;
    const { token, hash, hint } = this.freshToken();
    this.db
      .prepare(
        'INSERT INTO tx_sources (id, kind, name, enabled, token_hash, token_hint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, 'webhook', name, 1, hash, hint, Date.now());
    return { source: this.getSource(id)!, token };
  }
  rotateToken(id: string): SourceSecret | undefined {
    const src = this.getSource(id);
    if (!src || src.kind !== 'webhook') return undefined;
    const { token, hash, hint } = this.freshToken();
    this.db
      .prepare('UPDATE tx_sources SET token_hash = ?, token_hint = ? WHERE id = ?')
      .run(hash, hint, id);
    return { source: this.getSource(id)!, token };
  }
  revokeSource(id: string): void {
    this.db.prepare("DELETE FROM tx_sources WHERE id = ? AND kind = 'webhook'").run(id);
  }
  /** Constant-ish comparison of a presented token against the stored hash. */
  verifySourceToken(id: string, token: string): boolean {
    const r = this.db.prepare('SELECT token_hash, enabled FROM tx_sources WHERE id = ?').get(id) as
      { token_hash: string | null; enabled: number } | undefined;
    if (!r || !r.token_hash || !r.enabled) return false;
    return r.token_hash === sha256(token);
  }

  // --- signals ---

  private toSignal(r: Record<string, unknown>): Signal {
    return {
      id: r.id as string,
      ts: r.ts as number,
      severity: r.severity as Signal['severity'],
      title: r.title as string,
      body: (r.body as string | null) ?? undefined,
      source: r.source as string,
      read: Boolean(r.read),
    };
  }
  listSignals(limit = 200): Signal[] {
    return this.db
      .prepare('SELECT * FROM tx_signals ORDER BY ts DESC LIMIT ?')
      .all(limit)
      .map((r) => this.toSignal(r));
  }
  addSignal(s: Omit<Signal, 'id' | 'read'>): Signal {
    const id = `sig_${randomUUID().slice(0, 8)}`;
    this.db
      .prepare(
        'INSERT INTO tx_signals (id, ts, severity, title, body, source, read) VALUES (?, ?, ?, ?, ?, ?, 0)',
      )
      .run(id, s.ts, s.severity, s.title, s.body ?? null, s.source);
    return this.toSignal(
      this.db.prepare('SELECT * FROM tx_signals WHERE id = ?').get(id) as Record<string, unknown>,
    );
  }
  markRead(id: string): void {
    this.db.prepare('UPDATE tx_signals SET read = 1 WHERE id = ?').run(id);
  }
  markAllRead(): void {
    this.db.prepare('UPDATE tx_signals SET read = 1').run();
  }

  // --- deliveries ---

  listDeliveries(limit = 200): Delivery[] {
    return this.db
      .prepare('SELECT * FROM tx_deliveries ORDER BY ts DESC LIMIT ?')
      .all(limit)
      .map((r) => ({
        id: r.id as string,
        ts: r.ts as number,
        channelId: r.channel_id as string,
        channelName: r.channel_name as string,
        routeId: (r.route_id as string | null) ?? undefined,
        signalTitle: r.signal_title as string,
        ok: Boolean(r.ok),
        error: (r.error as string | null) ?? undefined,
      }));
  }
  addDelivery(d: Delivery): void {
    this.db
      .prepare(
        'INSERT INTO tx_deliveries (id, ts, channel_id, channel_name, route_id, signal_title, ok, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        d.id,
        d.ts,
        d.channelId,
        d.channelName,
        d.routeId ?? null,
        d.signalTitle,
        bit(d.ok),
        d.error ?? null,
      );
  }

  close(): void {
    this.db.close();
  }
}
