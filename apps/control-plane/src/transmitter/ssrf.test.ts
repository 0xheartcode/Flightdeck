import { describe, expect, it } from 'vitest';
import { assertOutboundAllowed, isBlockedIp, SsrfError } from './ssrf.js';

describe('isBlockedIp', () => {
  it('blocks loopback, link-local/metadata, and private ranges', () => {
    for (const ip of [
      '127.0.0.1',
      '169.254.169.254',
      '10.0.0.5',
      '172.16.0.1',
      '192.168.1.1',
      '0.0.0.0',
    ]) {
      expect(isBlockedIp(ip)).toBe(true);
    }
  });
  it('allows public addresses', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '203.0.113.10']) {
      expect(isBlockedIp(ip)).toBe(false);
    }
  });
  it('blocks IPv6 loopback and link-local', () => {
    expect(isBlockedIp('::1')).toBe(true);
    expect(isBlockedIp('fe80::1')).toBe(true);
    expect(isBlockedIp('fd00::1')).toBe(true);
  });
});

describe('assertOutboundAllowed', () => {
  const resolve = (map: Record<string, string[]>) => (host: string) =>
    Promise.resolve(map[host] ?? []);

  it('rejects non-http schemes', async () => {
    await expect(assertOutboundAllowed('ftp://example.com')).rejects.toBeInstanceOf(SsrfError);
  });

  it('rejects literal metadata and loopback IPs', async () => {
    await expect(
      assertOutboundAllowed('http://169.254.169.254/latest/meta-data/'),
    ).rejects.toBeInstanceOf(SsrfError);
    await expect(assertOutboundAllowed('http://127.0.0.1:9000/')).rejects.toBeInstanceOf(SsrfError);
  });

  it('rejects localhost by name', async () => {
    await expect(assertOutboundAllowed('http://localhost/hook')).rejects.toBeInstanceOf(SsrfError);
  });

  it('rejects a hostname that resolves into a blocked range (DNS rebinding)', async () => {
    await expect(
      assertOutboundAllowed(
        'https://evil.example.com/hook',
        resolve({ 'evil.example.com': ['169.254.169.254'] }),
      ),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it('allows a hostname that resolves to a public address', async () => {
    const url = await assertOutboundAllowed(
      'https://hooks.example.com/x',
      resolve({ 'hooks.example.com': ['93.184.216.34'] }),
    );
    expect(url.hostname).toBe('hooks.example.com');
  });
});
