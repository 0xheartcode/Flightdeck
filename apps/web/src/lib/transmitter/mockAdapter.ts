import type {
  Channel,
  ChannelInput,
  Delivery,
  RouteInput,
  RouteRule,
  Signal,
  Source,
  SourceInput,
  SourceSecret,
  TransmitterClient,
} from './types';

/**
 * In-memory Transmitter backend for development and tests ONLY. It mirrors the
 * contract in docs/design/TRANSMITTER-API.md, including the security-relevant
 * behaviours the UI depends on:
 *   - credentials are write-only: they are accepted but never returned;
 *   - inbound source tokens are generated once and only a 4-char hint is kept;
 *   - testChannel and any "send" are simulated — nothing leaves the browser.
 * It never performs real network I/O, so it can never send a real notification.
 */
export class MockTransmitter implements TransmitterClient {
  private signals: Signal[];
  private channels: Channel[];
  private routes: RouteRule[];
  private sources: Source[];
  private deliveries: Delivery[];

  constructor(now: number = Date.now()) {
    this.sources = [
      {
        id: 'src_builtin',
        kind: 'builtin',
        name: 'Flightdeck events',
        enabled: true,
        createdAt: now - 864e5,
      },
      {
        id: 'src_watcher',
        kind: 'webhook',
        name: 'flightdeck-watcher',
        enabled: true,
        tokenHint: '3f9a',
        createdAt: now - 36e5,
      },
    ];
    this.channels = [
      {
        id: 'ch_tg',
        kind: 'telegram',
        name: 'On-call Telegram',
        config: { chatId: '-1001234567890' },
        enabled: true,
        credentialSet: true,
        credentialUpdatedAt: now - 72e5,
      },
      {
        id: 'ch_slack',
        kind: 'slack',
        name: 'Engineering #alerts',
        config: { url: 'https://hooks.slack.com/services/…' },
        enabled: true,
        credentialSet: true,
        credentialUpdatedAt: now - 48e5,
      },
    ];
    this.routes = [
      {
        id: 'rt_crit',
        name: 'Critical → everywhere',
        match: { eventTypes: [], minSeverity: 'error', projects: [] },
        channelIds: ['ch_tg', 'ch_slack'],
        throttlePerMin: 10,
        muted: false,
      },
    ];
    this.signals = [
      {
        id: 'sig1',
        ts: now - 6e5,
        severity: 'error',
        title: 'control-plane exited',
        body: 'Container exited with code 1',
        source: 'src_builtin',
        read: false,
      },
      {
        id: 'sig2',
        ts: now - 18e5,
        severity: 'warning',
        title: 'High memory on web',
        body: '92% of limit',
        source: 'src_watcher',
        read: false,
      },
      {
        id: 'sig3',
        ts: now - 36e5,
        severity: 'info',
        title: 'Deploy succeeded',
        body: 'acme/web @ a1b2c3d',
        source: 'src_builtin',
        read: true,
      },
    ];
    this.deliveries = [
      {
        id: 'dl1',
        ts: now - 6e5,
        channelId: 'ch_tg',
        channelName: 'On-call Telegram',
        routeId: 'rt_crit',
        signalTitle: 'control-plane exited',
        ok: true,
      },
      {
        id: 'dl2',
        ts: now - 6e5,
        channelId: 'ch_slack',
        channelName: 'Engineering #alerts',
        routeId: 'rt_crit',
        signalTitle: 'control-plane exited',
        ok: false,
        error: 'HTTP 429 (rate limited)',
      },
    ];
  }

  private id(prefix: string): string {
    return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
  }

  listSignals(): Promise<Signal[]> {
    return Promise.resolve([...this.signals].sort((a, b) => b.ts - a.ts));
  }
  markRead(id: string): Promise<void> {
    this.signals = this.signals.map((s) => (s.id === id ? { ...s, read: true } : s));
    return Promise.resolve();
  }
  markAllRead(): Promise<void> {
    this.signals = this.signals.map((s) => ({ ...s, read: true }));
    return Promise.resolve();
  }

  listChannels(): Promise<Channel[]> {
    // Return a copy with no secret material (there is none stored here anyway).
    return Promise.resolve(this.channels.map((c) => ({ ...c })));
  }
  createChannel(input: ChannelInput): Promise<Channel> {
    const ch: Channel = {
      id: this.id('ch'),
      kind: input.kind,
      name: input.name,
      config: input.config,
      enabled: input.enabled,
      // The credential is accepted but discarded here (write-only); we keep only
      // the fact that one was set.
      credentialSet: Boolean(input.credential),
      credentialUpdatedAt: input.credential ? Date.now() : undefined,
    };
    this.channels = [...this.channels, ch];
    return Promise.resolve({ ...ch });
  }
  updateChannel(id: string, input: ChannelInput): Promise<Channel> {
    let updated: Channel | undefined;
    this.channels = this.channels.map((c) => {
      if (c.id !== id) return c;
      updated = {
        ...c,
        name: input.name,
        config: input.config,
        enabled: input.enabled,
        // Only replace the credential when a new one is provided.
        credentialSet: input.credential ? true : c.credentialSet,
        credentialUpdatedAt: input.credential ? Date.now() : c.credentialUpdatedAt,
      };
      return updated;
    });
    if (!updated) return Promise.reject(new Error('channel not found'));
    return Promise.resolve({ ...updated });
  }
  deleteChannel(id: string): Promise<void> {
    this.channels = this.channels.filter((c) => c.id !== id);
    this.routes = this.routes.map((r) => ({
      ...r,
      channelIds: r.channelIds.filter((c) => c !== id),
    }));
    return Promise.resolve();
  }
  testChannel(id: string): Promise<Delivery> {
    const ch = this.channels.find((c) => c.id === id);
    if (!ch) return Promise.reject(new Error('channel not found'));
    // Simulated only — no real network call is ever made.
    const ok = ch.credentialSet && ch.enabled;
    const delivery: Delivery = {
      id: this.id('dl'),
      ts: Date.now(),
      channelId: ch.id,
      channelName: ch.name,
      signalTitle: 'Test notification',
      ok,
      error: ok ? undefined : ch.credentialSet ? 'Channel disabled' : 'No credential set',
    };
    this.deliveries = [delivery, ...this.deliveries];
    return Promise.resolve(delivery);
  }

  listRoutes(): Promise<RouteRule[]> {
    return Promise.resolve(this.routes.map((r) => ({ ...r })));
  }
  createRoute(input: RouteInput): Promise<RouteRule> {
    const rt: RouteRule = { ...input, id: this.id('rt') };
    this.routes = [...this.routes, rt];
    return Promise.resolve({ ...rt });
  }
  updateRoute(id: string, input: RouteInput): Promise<RouteRule> {
    let updated: RouteRule | undefined;
    this.routes = this.routes.map((r) => (r.id === id ? (updated = { ...input, id }) : r));
    if (!updated) return Promise.reject(new Error('route not found'));
    return Promise.resolve({ ...updated });
  }
  deleteRoute(id: string): Promise<void> {
    this.routes = this.routes.filter((r) => r.id !== id);
    return Promise.resolve();
  }

  listSources(): Promise<Source[]> {
    return Promise.resolve(this.sources.map((s) => ({ ...s })));
  }
  createSource(input: SourceInput): Promise<SourceSecret> {
    const token = `fdwh_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    const source: Source = {
      id: this.id('src'),
      kind: 'webhook',
      name: input.name,
      enabled: true,
      tokenHint: token.slice(-4),
      createdAt: Date.now(),
    };
    this.sources = [...this.sources, source];
    // The token is returned exactly once; only the hint is retained.
    return Promise.resolve({ source: { ...source }, token });
  }
  rotateToken(id: string): Promise<SourceSecret> {
    const token = `fdwh_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    let source: Source | undefined;
    this.sources = this.sources.map((s) =>
      s.id === id ? (source = { ...s, tokenHint: token.slice(-4) }) : s,
    );
    if (!source) return Promise.reject(new Error('source not found'));
    return Promise.resolve({ source: { ...source }, token });
  }
  revokeSource(id: string): Promise<void> {
    this.sources = this.sources.filter((s) => s.id !== id || s.kind === 'builtin');
    return Promise.resolve();
  }

  listDeliveries(): Promise<Delivery[]> {
    return Promise.resolve([...this.deliveries].sort((a, b) => b.ts - a.ts));
  }
}
