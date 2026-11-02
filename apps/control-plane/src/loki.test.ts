import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import type { LogLine } from '@flightdeck/protocol';
import { buildLogQL, LokiClient } from './loki.js';

const line = (
  serviceId: string,
  stream: 'stdout' | 'stderr',
  ts: number,
  text: string,
): LogLine => ({
  serviceId,
  stream,
  ts,
  line: text,
});

interface PushBody {
  streams: Array<{ stream: Record<string, string>; values: [string, string][] }>;
}

describe('buildLogQL', () => {
  it('builds a selector, adding a line filter when a query is given', () => {
    expect(buildLogQL('host/api', undefined)).toBe('{service="host/api",job="flightdeck"}');
    expect(buildLogQL('host/api', 'oops')).toBe('{service="host/api",job="flightdeck"} |= "oops"');
  });
});

describe('LokiClient.push', () => {
  it('batches lines and pushes them grouped into streams (ms -> ns)', async () => {
    let received: PushBody | undefined;
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        received = JSON.parse(body) as PushBody;
        res.statusCode = 204;
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;

    try {
      const loki = new LokiClient(`http://127.0.0.1:${port}`, '');
      loki.push(line('svc', 'stdout', 1, 'a'));
      loki.push(line('svc', 'stdout', 2, 'b'));
      loki.push(line('svc', 'stderr', 3, 'c'));
      await loki.flush();

      expect(received?.streams).toHaveLength(2);
      const stdout = received?.streams.find((s) => s.stream.stream === 'stdout');
      expect(stdout?.stream).toMatchObject({ service: 'svc', job: 'flightdeck' });
      expect(stdout?.values).toEqual([
        ['1000000', 'a'],
        ['2000000', 'b'],
      ]);
      // A flushed batch is cleared (a second flush sends nothing).
      received = undefined;
      await loki.flush();
      expect(received).toBeUndefined();
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe('LokiClient.search', () => {
  it('queries query_range and returns lines sorted oldest-first', async () => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          data: {
            result: [
              {
                stream: { stream: 'stdout', service: 'svc' },
                values: [
                  ['2000000', 'later'],
                  ['1000000', 'earlier'],
                ],
              },
            ],
          },
        }),
      );
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;

    try {
      const loki = new LokiClient(`http://127.0.0.1:${port}`, '');
      const lines = await loki.search('svc', 'x', 0, 10);
      expect(lines.map((l) => l.line)).toEqual(['earlier', 'later']);
      expect(lines[0]).toMatchObject({ ts: 1, stream: 'stdout' });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('returns an empty list when Loki errors', async () => {
    const server = createServer((_req, res) => {
      res.statusCode = 500;
      res.end('boom');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    try {
      const loki = new LokiClient(`http://127.0.0.1:${port}`, '');
      expect(await loki.search('svc', undefined, 0, 10)).toEqual([]);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
