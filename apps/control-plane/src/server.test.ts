import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '@flightdeck/protocol';
import type { Config } from './config.js';
import { startControlPlane, type ControlPlaneHandle } from './server.js';

function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    host: '127.0.0.1',
    port: 0, // ephemeral
    agentToken: 'test-token',
    agentTokens: '',
    agentTokensFile: '',
    dashboardToken: '',
    corsOrigin: '*',
    logBufferSize: 100,
    maxPayloadBytes: 262_144,
    maxServices: 100,
    actionsEnabled: true,
    actionTimeoutMs: 2000,
    auditMax: 50,
    auditFile: '',
    dbFile: ':memory:',
    githubWebhookSecret: '',
    maxConnections: 1000,
    actionRatePerMin: 30,
    ...overrides,
  };
}

type Msg = Record<string, unknown>;

function collect(ws: WebSocket): Msg[] {
  const msgs: Msg[] = [];
  ws.on('message', (data) => msgs.push(JSON.parse(data.toString()) as Msg));
  return msgs;
}

function open(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', (err) => reject(err));
    ws.once('unexpected-response', (_req, res) => reject(new Error(`http ${res.statusCode}`)));
  });
}

async function waitFor<T>(fn: () => T | undefined, timeout = 3000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const v = PROTOCOL_VERSION;

describe('control plane integration', () => {
  let cp: ControlPlaneHandle | undefined;

  afterEach(async () => {
    await cp?.close();
    cp = undefined;
  });

  it('streams a log from agent to browser and routes a restart action', async () => {
    cp = startControlPlane(testConfig());
    const port = await cp.listening;

    const agent = new WebSocket(`ws://127.0.0.1:${port}/agent`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    const agentMsgs = collect(agent);
    await open(agent);
    agent.send(JSON.stringify({ v, type: 'hello', agentId: 'a1', hostname: 'test-host' }));
    agent.send(
      JSON.stringify({
        v,
        type: 'service',
        service: {
          id: 'svc',
          name: 'svc',
          image: 'img',
          containerId: 'cid',
          state: 'running',
          host: 'test-host',
          createdAt: 0,
        },
      }),
    );
    agent.send(
      JSON.stringify({
        v,
        type: 'log',
        log: { serviceId: 'svc', stream: 'stdout', ts: 1, line: 'hello world' },
      }),
    );
    // Reply to any command with success.
    agent.on('message', (data) => {
      const m = JSON.parse(data.toString()) as Msg;
      if (m.type === 'command') {
        agent.send(JSON.stringify({ v, type: 'command_result', id: m.id, ok: true }));
      }
    });

    const browser = new WebSocket(`ws://127.0.0.1:${port}/stream`);
    const browserMsgs = collect(browser);
    await open(browser);
    browser.send(JSON.stringify({ type: 'subscribe', serviceId: 'svc' }));

    // The service appears and the recent log is delivered (via snapshot or live).
    await waitFor(() =>
      browserMsgs.find(
        (m) =>
          m.type === 'services' &&
          (m.services as Array<{ id: string }>).some((s) => s.id === 'svc'),
      ),
    );
    await waitFor(() =>
      browserMsgs.find(
        (m) =>
          (m.type === 'snapshot' &&
            (m.logs as Array<{ line: string }>).some((l) => l.line === 'hello world')) ||
          (m.type === 'log' && (m.log as { line: string }).line === 'hello world'),
      ),
    );

    // Trigger a restart; the agent receives the command, the browser gets the result.
    browser.send(JSON.stringify({ type: 'action', action: 'restart', serviceId: 'svc' }));
    const command = await waitFor(() =>
      agentMsgs.find((m) => m.type === 'command' && m.action === 'restart'),
    );
    expect(command.containerId).toBe('cid');
    const result = await waitFor(() => browserMsgs.find((m) => m.type === 'action_result'));
    expect(result.ok).toBe(true);

    agent.close();
    browser.close();
  });

  it('rejects an agent presenting a wrong token', async () => {
    cp = startControlPlane(testConfig());
    const port = await cp.listening;
    const agent = new WebSocket(`ws://127.0.0.1:${port}/agent`, {
      headers: { Authorization: 'Bearer wrong' },
    });
    await expect(open(agent)).rejects.toBeTruthy();
  });
});
