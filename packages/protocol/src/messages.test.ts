import { describe, expect, it } from 'vitest';
import {
  parseAgentMessage,
  parseClientMessage,
  PROTOCOL_VERSION,
  ServiceInfo,
} from './messages.js';

describe('protocol', () => {
  it('round-trips a log message', () => {
    const msg = parseAgentMessage(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'log',
        log: { serviceId: 'api', stream: 'stdout', ts: 1700000000000, line: 'hello' },
      }),
    );
    expect(msg.type).toBe('log');
    if (msg.type === 'log') {
      expect(msg.log.line).toBe('hello');
      expect(msg.log.stream).toBe('stdout');
    }
  });

  it('rejects an unknown agent message type', () => {
    expect(() =>
      parseAgentMessage(JSON.stringify({ v: PROTOCOL_VERSION, type: 'nope' })),
    ).toThrow();
  });

  it('rejects a log message with the wrong protocol version', () => {
    expect(() =>
      parseAgentMessage(
        JSON.stringify({
          v: 999,
          type: 'log',
          log: { serviceId: 'api', stream: 'stdout', ts: 1, line: 'x' },
        }),
      ),
    ).toThrow();
  });

  it('validates a service info shape', () => {
    const service = ServiceInfo.parse({
      id: 'api',
      name: 'api',
      image: 'ghcr.io/acme/api:latest',
      containerId: 'abc123',
      state: 'running',
      host: 'server-a',
      createdAt: 1700000000000,
    });
    expect(service.state).toBe('running');
  });

  it('parses a client subscribe message', () => {
    const msg = parseClientMessage(JSON.stringify({ type: 'subscribe', serviceId: 'api' }));
    expect(msg.type).toBe('subscribe');
  });

  it('parses restart and redeploy actions and rejects unknown ones', () => {
    for (const action of ['restart', 'redeploy']) {
      const msg = parseClientMessage(JSON.stringify({ type: 'action', action, serviceId: 'api' }));
      expect(msg.type).toBe('action');
    }
    expect(() =>
      parseClientMessage(JSON.stringify({ type: 'action', action: 'nuke', serviceId: 'api' })),
    ).toThrow();
  });

  it('parses an agent command_result', () => {
    const msg = parseAgentMessage(
      JSON.stringify({ v: PROTOCOL_VERSION, type: 'command_result', id: 'c1', ok: true }),
    );
    expect(msg.type).toBe('command_result');
    if (msg.type === 'command_result') {
      expect(msg.ok).toBe(true);
    }
  });
});
