import { describe, expect, it } from 'vitest';
import {
  AgentHello,
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

  it('accepts a service info with exposure fields and keeps them optional', () => {
    const withExposure = ServiceInfo.parse({
      id: 'api',
      name: 'api',
      image: 'ghcr.io/acme/api:latest',
      containerId: 'abc123',
      state: 'running',
      host: 'server-a',
      createdAt: 1700000000000,
      ports: [
        { containerPort: 8080, protocol: 'tcp', hostPort: 8080, hostIp: '0.0.0.0', public: true },
        {
          containerPort: 5432,
          protocol: 'tcp',
          hostPort: 5432,
          hostIp: '127.0.0.1',
          public: false,
        },
      ],
      networks: [{ network: 'bridge', ipAddress: '172.17.0.2' }],
      routes: [{ domain: 'api.example.com', source: 'traefik-label', tls: true }],
    });
    expect(withExposure.ports?.[0]?.public).toBe(true);
    expect(withExposure.ports?.[1]?.public).toBe(false);
    expect(withExposure.routes?.[0]?.domain).toBe('api.example.com');

    // An older agent omitting the fields is still valid.
    const bare = ServiceInfo.parse({
      id: 'api',
      name: 'api',
      image: 'x',
      containerId: 'abc123',
      state: 'running',
      host: 'server-a',
      createdAt: 1,
    });
    expect(bare.ports).toBeUndefined();
  });

  it('rejects an unknown route source', () => {
    expect(() =>
      ServiceInfo.parse({
        id: 'api',
        name: 'api',
        image: 'x',
        containerId: 'abc123',
        state: 'running',
        host: 'server-a',
        createdAt: 1,
        routes: [{ domain: 'api.example.com', source: 'nginx-file' }],
      }),
    ).toThrow();
  });

  it('accepts an agent hello with reserved lanIps and without it', () => {
    const base = { v: PROTOCOL_VERSION, type: 'hello', agentId: 'a1', hostname: 'server-a' };
    expect(AgentHello.parse(base).lanIps).toBeUndefined();
    const withIps = AgentHello.parse({ ...base, lanIps: ['10.0.0.4', '192.168.1.20'] });
    expect(withIps.lanIps).toEqual(['10.0.0.4', '192.168.1.20']);
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

  it('parses a set_env client message with its env payload', () => {
    const msg = parseClientMessage(
      JSON.stringify({
        type: 'set_env',
        serviceId: 'api',
        env: [{ key: 'A', value: '1' }],
      }),
    );
    expect(msg.type).toBe('set_env');
    if (msg.type === 'set_env') {
      expect(msg.env).toEqual([{ key: 'A', value: '1' }]);
    }
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
