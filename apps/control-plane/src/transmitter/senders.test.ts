import { describe, expect, it } from 'vitest';
import { realSend } from './senders.js';
import type { Channel, Signal } from './types.js';

const signal: Signal = {
  id: 's',
  ts: 0,
  severity: 'error',
  title: 'boom',
  source: 'src_builtin',
  read: false,
};

const channel = (over: Partial<Channel>): Channel => ({
  id: 'c',
  kind: 'webhook',
  name: 'c',
  config: {},
  enabled: true,
  credentialSet: false,
  ...over,
});

describe('realSend guards (no real network)', () => {
  it('blocks a webhook pointed at a loopback/metadata address (SSRF)', async () => {
    await expect(
      realSend(
        channel({ kind: 'webhook', config: { url: 'http://169.254.169.254/' } }),
        undefined,
        signal,
      ),
    ).rejects.toThrow();
    await expect(
      realSend(
        channel({ kind: 'slack', config: { url: 'http://127.0.0.1:9000/' } }),
        undefined,
        signal,
      ),
    ).rejects.toThrow();
  });

  it('rejects a webhook with no URL before making any request', async () => {
    await expect(
      realSend(channel({ kind: 'discord', config: {} }), undefined, signal),
    ).rejects.toThrow(/URL/i);
  });

  it('rejects email with incomplete SMTP config before connecting', async () => {
    await expect(
      realSend(channel({ kind: 'email', config: { host: 'smtp.example.com:587' } }), 'pw', signal),
    ).rejects.toThrow(/SMTP|from|to/i);
  });

  it('rejects telegram without a bot token', async () => {
    await expect(
      realSend(channel({ kind: 'telegram', config: { chatId: '1' } }), undefined, signal),
    ).rejects.toThrow(/token/i);
  });
});
