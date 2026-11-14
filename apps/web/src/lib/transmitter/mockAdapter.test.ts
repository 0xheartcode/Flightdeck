import { describe, expect, it } from 'vitest';
import { MockTransmitter } from './mockAdapter';

describe('MockTransmitter security behaviours', () => {
  it('never returns channel credentials, only that one is set', async () => {
    const tx = new MockTransmitter();
    const ch = await tx.createChannel({
      kind: 'telegram',
      name: 'test',
      config: { chatId: '1' },
      enabled: true,
      credential: 'super-secret-bot-token',
    });
    expect(ch.credentialSet).toBe(true);
    // The secret must not appear anywhere on the returned object.
    expect(JSON.stringify(ch)).not.toContain('super-secret-bot-token');
    const list = await tx.listChannels();
    expect(JSON.stringify(list)).not.toContain('super-secret-bot-token');
  });

  it('keeps an existing credential when update omits it', async () => {
    const tx = new MockTransmitter();
    const ch = await tx.createChannel({
      kind: 'slack',
      name: 's',
      config: {},
      enabled: true,
      credential: 'x',
    });
    const updated = await tx.updateChannel(ch.id, {
      kind: 'slack',
      name: 's2',
      config: {},
      enabled: true,
    });
    expect(updated.credentialSet).toBe(true);
    expect(updated.name).toBe('s2');
  });

  it('returns an inbound token exactly once and retains only a 4-char hint', async () => {
    const tx = new MockTransmitter();
    const { source, token } = await tx.createSource({ name: 'ci' });
    expect(token.length).toBeGreaterThan(8);
    expect(source.tokenHint).toBe(token.slice(-4));
    // The listed source exposes the hint, never the token.
    const list = await tx.listSources();
    const found = list.find((s) => s.id === source.id);
    expect(found?.tokenHint).toBe(token.slice(-4));
    expect(JSON.stringify(list)).not.toContain(token);
  });

  it('rotates to a new token and updates the hint', async () => {
    const tx = new MockTransmitter();
    const { source, token } = await tx.createSource({ name: 'ci' });
    const rotated = await tx.rotateToken(source.id);
    expect(rotated.token).not.toBe(token);
    expect(rotated.source.tokenHint).toBe(rotated.token.slice(-4));
  });

  it('testChannel never throws and records a delivery without sending', async () => {
    const tx = new MockTransmitter();
    const channels = await tx.listChannels();
    const first = channels[0];
    expect(first).toBeDefined();
    if (!first) return;
    const delivery = await tx.testChannel(first.id);
    expect(delivery.channelId).toBe(first.id);
    const log = await tx.listDeliveries();
    expect(log.some((d) => d.id === delivery.id)).toBe(true);
  });
});
