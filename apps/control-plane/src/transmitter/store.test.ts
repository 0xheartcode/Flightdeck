import { describe, expect, it } from 'vitest';
import { TransmitterStore } from './store.js';

describe('TransmitterStore', () => {
  it('seeds exactly one always-on builtin source', () => {
    const store = new TransmitterStore();
    const builtins = store.listSources().filter((s) => s.kind === 'builtin');
    expect(builtins).toHaveLength(1);
    expect(builtins[0]?.name).toBe('Flightdeck events');
  });

  it('stores a channel credential but never returns it', () => {
    const store = new TransmitterStore();
    const ch = store.createChannel({
      kind: 'telegram',
      name: 'oncall',
      config: { chatId: '1' },
      enabled: true,
      credential: 'secret-bot-token',
    });
    expect(ch.credentialSet).toBe(true);
    expect(JSON.stringify(store.listChannels())).not.toContain('secret-bot-token');
    // The dispatcher-only accessor can read it.
    expect(store.getChannelCredential(ch.id)).toBe('secret-bot-token');
  });

  it('keeps the credential when an update omits it', () => {
    const store = new TransmitterStore();
    const ch = store.createChannel({
      kind: 'slack',
      name: 's',
      config: {},
      enabled: true,
      credential: 'x',
    });
    store.updateChannel(ch.id, { kind: 'slack', name: 's2', config: {}, enabled: true });
    expect(store.getChannelCredential(ch.id)).toBe('x');
  });

  it('issues an inbound token once, stores only a hash, and verifies it', () => {
    const store = new TransmitterStore();
    const { source, token } = store.createSource('ci');
    expect(source.tokenHint).toBe(token.slice(-4));
    // The token is never persisted in listable state.
    expect(JSON.stringify(store.listSources())).not.toContain(token);
    expect(store.verifySourceToken(source.id, token)).toBe(true);
    expect(store.verifySourceToken(source.id, 'wrong')).toBe(false);
  });

  it('rotates to a new token and invalidates the old one', () => {
    const store = new TransmitterStore();
    const { source, token } = store.createSource('ci');
    const rotated = store.rotateToken(source.id)!;
    expect(rotated.token).not.toBe(token);
    expect(store.verifySourceToken(source.id, token)).toBe(false);
    expect(store.verifySourceToken(source.id, rotated.token)).toBe(true);
  });

  it('removes a deleted channel from routes', () => {
    const store = new TransmitterStore();
    const ch = store.createChannel({ kind: 'slack', name: 's', config: {}, enabled: true });
    const rt = store.createRoute({
      name: 'r',
      match: { eventTypes: [], minSeverity: 'info', projects: [] },
      channelIds: [ch.id],
      muted: false,
    });
    store.deleteChannel(ch.id);
    expect(store.listRoutes().find((r) => r.id === rt.id)?.channelIds).toEqual([]);
  });
});
