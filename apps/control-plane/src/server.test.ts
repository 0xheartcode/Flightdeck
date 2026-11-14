import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '@flightdeck/protocol';
import type { Config } from './config.js';
import { mintHs256 } from './config.testutil.js';
import { startControlPlane, type ControlPlaneHandle } from './server.js';

const future = Math.floor(Date.now() / 1000) + 3600;

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
    transmitterEnabled: false,
    transmitterDbFile: ':memory:',
    actionTimeoutMs: 2000,
    auditMax: 50,
    auditFile: '',
    dbFile: ':memory:',
    databaseUrl: '',
    githubWebhookSecret: '',
    maxConnections: 1000,
    actionRatePerMin: 30,
    oidcIssuer: '',
    oidcAudience: '',
    oidcHs256Secret: '',
    oidcRs256PublicKey: '',
    oidcJwksUri: '',
    oidcRolesClaim: 'roles',
    operatorRoles: [],
    adminRoles: [],
    oidcClientId: '',
    oidcClientSecret: '',
    oidcAuthEndpoint: '',
    oidcTokenEndpoint: '',
    oidcRedirectUri: '',
    oidcScopes: 'openid profile email',
    sessionSecret: '',
    webAppUrl: 'http://localhost:5173',
    lokiUrl: '',
    lokiTenant: '',
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
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function connectAgent(port: number, hostname: string): Promise<WebSocket> {
  const agent = new WebSocket(`ws://127.0.0.1:${port}/agent`, {
    headers: { Authorization: 'Bearer test-token' },
  });
  await open(agent);
  agent.send(JSON.stringify({ v, type: 'hello', agentId: 'a', hostname }));
  return agent;
}

function serviceMsg(id: string, host: string): string {
  return JSON.stringify({
    v,
    type: 'service',
    service: {
      id,
      name: id,
      image: 'img',
      containerId: 'c',
      state: 'running',
      host,
      createdAt: 0,
    },
  });
}

async function serviceIds(port: number): Promise<string[]> {
  const d = (await (await fetch(`http://127.0.0.1:${port}/api/services`)).json()) as {
    services: Array<{ id: string }>;
  };
  return d.services.map((s) => s.id);
}

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

  it('rejects a service announced for a host other than the agent connected as', async () => {
    cp = startControlPlane(testConfig());
    const port = await cp.listening;
    const agent = await connectAgent(port, 'host-a');
    agent.send(serviceMsg('spoof', 'host-b')); // host mismatch -> dropped
    agent.send(serviceMsg('legit', 'host-a')); // own host -> accepted

    let ids: string[] = [];
    for (let i = 0; i < 30; i++) {
      ids = await serviceIds(port);
      if (ids.includes('legit')) break;
      await sleep(30);
    }
    expect(ids).toContain('legit');
    expect(ids).not.toContain('spoof');
    agent.close();
  });

  it('reports actions disabled when FD_ENABLE_ACTIONS is off', async () => {
    cp = startControlPlane(testConfig({ actionsEnabled: false }));
    const port = await cp.listening;
    const agent = await connectAgent(port, 'host-a');
    agent.send(serviceMsg('svc', 'host-a'));

    const browser = new WebSocket(`ws://127.0.0.1:${port}/stream`);
    const browserMsgs = collect(browser);
    await open(browser);
    browser.send(JSON.stringify({ type: 'subscribe', serviceId: 'svc' }));
    await sleep(100);
    browser.send(JSON.stringify({ type: 'action', action: 'restart', serviceId: 'svc' }));

    const res = await waitFor(() => browserMsgs.find((m) => m.type === 'action_result'));
    expect(res.ok).toBe(false);
    expect(res.error).toBe('actions are disabled');
    agent.close();
    browser.close();
  });

  it('rate limits browser actions', async () => {
    cp = startControlPlane(testConfig({ actionRatePerMin: 1 }));
    const port = await cp.listening;
    const browser = new WebSocket(`ws://127.0.0.1:${port}/stream`);
    const browserMsgs = collect(browser);
    await open(browser);
    // No such service: first action is "unknown service", second is rate limited.
    browser.send(JSON.stringify({ type: 'action', action: 'restart', serviceId: 'nope' }));
    browser.send(JSON.stringify({ type: 'action', action: 'restart', serviceId: 'nope' }));

    await waitFor(() =>
      browserMsgs.filter((m) => m.type === 'action_result').length >= 2 ? true : undefined,
    );
    const errors = browserMsgs
      .filter((m) => m.type === 'action_result')
      .map((m) => m.error as string);
    expect(errors).toContain('rate limited');
    browser.close();
  });

  it('gates actions by role when identity is enabled', async () => {
    const SECRET = 'stream-secret';
    cp = startControlPlane(testConfig({ oidcHs256Secret: SECRET, operatorRoles: ['operator'] }));
    const port = await cp.listening;

    const agent = await connectAgent(port, 'host-a');
    agent.on('message', (data) => {
      const m = JSON.parse(data.toString()) as Msg;
      if (m.type === 'command') {
        agent.send(JSON.stringify({ v, type: 'command_result', id: m.id, ok: true }));
      }
    });
    agent.send(serviceMsg('svc', 'host-a'));

    const connectBrowser = async (roles: string[]): Promise<[WebSocket, Msg[]]> => {
      const token = mintHs256({ sub: roles.join(), roles, exp: future }, SECRET);
      const ws = new WebSocket(`ws://127.0.0.1:${port}/stream?token=${token}`);
      const msgs = collect(ws);
      await open(ws);
      await waitFor(() =>
        msgs.find(
          (m) =>
            m.type === 'services' &&
            (m.services as Array<{ id: string }>).some((s) => s.id === 'svc'),
        ),
      );
      ws.send(JSON.stringify({ type: 'subscribe', serviceId: 'svc' }));
      return [ws, msgs];
    };

    // A viewer (no operator role) is refused.
    const [viewer, viewerMsgs] = await connectBrowser(['viewer']);
    viewer.send(JSON.stringify({ type: 'action', action: 'restart', serviceId: 'svc' }));
    const denied = await waitFor(() => viewerMsgs.find((m) => m.type === 'action_result'));
    expect(denied.ok).toBe(false);
    expect(denied.error).toBe('forbidden: operator role required');

    // An operator is allowed and the agent receives the command.
    const [operator, operatorMsgs] = await connectBrowser(['operator']);
    operator.send(JSON.stringify({ type: 'action', action: 'restart', serviceId: 'svc' }));
    const allowed = await waitFor(() => operatorMsgs.find((m) => m.type === 'action_result'));
    expect(allowed.ok).toBe(true);

    viewer.close();
    operator.close();
    agent.close();
  });

  it('stores env from the agent, masks it on the API, and keeps it off the stream', async () => {
    const SECRET = 'env-secret';
    cp = startControlPlane(
      testConfig({ oidcHs256Secret: SECRET, operatorRoles: ['operator'], adminRoles: ['admin'] }),
    );
    const port = await cp.listening;

    const agent = await connectAgent(port, 'host-a');
    agent.send(
      JSON.stringify({
        v,
        type: 'service',
        service: {
          id: 'svc',
          name: 'svc',
          image: 'img',
          containerId: 'c',
          state: 'running',
          host: 'host-a',
          createdAt: 0,
          env: [{ key: 'SECRET_KEY', value: 's3cr3t' }],
        },
      }),
    );

    const operator = mintHs256({ sub: 'op', roles: ['operator'], exp: future }, SECRET);
    const admin = mintHs256({ sub: 'ad', roles: ['admin'], exp: future }, SECRET);
    const getJson = async (path: string, token: string): Promise<Msg> =>
      (await (
        await fetch(`http://127.0.0.1:${port}${path}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).json()) as Msg;

    // Wait for the service to register, then read it as an operator: env masked.
    let detail: Msg | undefined;
    for (let i = 0; i < 40; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/api/services/svc`, {
        headers: { Authorization: `Bearer ${operator}` },
      });
      if (res.status === 200) {
        detail = (await res.json()) as Msg;
        break;
      }
      await sleep(30);
    }
    expect(detail?.env).toEqual([{ key: 'SECRET_KEY', value: '********' }]);

    // The service list never carries env.
    const list = (await getJson('/api/services', operator)) as {
      services: Array<Record<string, unknown>>;
    };
    expect(list.services[0]).not.toHaveProperty('env');

    // An admin reveals the real value.
    const adminDetail = await getJson('/api/services/svc', admin);
    expect(adminDetail.env).toEqual([{ key: 'SECRET_KEY', value: 's3cr3t' }]);

    agent.close();
  });

  it('edits env via set_env, gated on the admin role', async () => {
    const SECRET = 'setenv-secret';
    cp = startControlPlane(
      testConfig({ oidcHs256Secret: SECRET, operatorRoles: ['operator'], adminRoles: ['admin'] }),
    );
    const port = await cp.listening;

    const agent = await connectAgent(port, 'host-a');
    const agentMsgs = collect(agent);
    agent.on('message', (data) => {
      const m = JSON.parse(data.toString()) as Msg;
      if (m.type === 'command') {
        agent.send(JSON.stringify({ v, type: 'command_result', id: m.id, ok: true }));
      }
    });
    agent.send(
      JSON.stringify({
        v,
        type: 'service',
        service: {
          id: 'svc',
          name: 'svc',
          image: 'img',
          containerId: 'c',
          state: 'running',
          host: 'host-a',
          createdAt: 0,
          env: [{ key: 'A', value: '1' }],
        },
      }),
    );

    const connect = async (roles: string[]): Promise<[WebSocket, Msg[]]> => {
      const token = mintHs256({ sub: roles.join(), roles, exp: future }, SECRET);
      const ws = new WebSocket(`ws://127.0.0.1:${port}/stream?token=${token}`);
      const msgs = collect(ws);
      await open(ws);
      await waitFor(() =>
        msgs.find(
          (m) =>
            m.type === 'services' &&
            (m.services as Array<{ id: string }>).some((s) => s.id === 'svc'),
        ),
      );
      return [ws, msgs];
    };

    // An operator (no admin role) cannot edit env.
    const [op, opMsgs] = await connect(['operator']);
    op.send(JSON.stringify({ type: 'set_env', serviceId: 'svc', env: [{ key: 'A', value: '2' }] }));
    const denied = await waitFor(() => opMsgs.find((m) => m.type === 'action_result'));
    expect(denied.ok).toBe(false);
    expect(denied.error).toBe('forbidden: admin role required');

    // An admin can: the agent receives a set_env command with the new env.
    const next = [
      { key: 'A', value: '2' },
      { key: 'B', value: 'x' },
    ];
    const [admin, adminMsgs] = await connect(['admin']);
    admin.send(JSON.stringify({ type: 'set_env', serviceId: 'svc', env: next }));
    const ok = await waitFor(() =>
      adminMsgs.find((m) => m.type === 'action_result' && m.action === 'set_env'),
    );
    expect(ok.ok).toBe(true);
    const cmd = await waitFor(() =>
      agentMsgs.find((m) => m.type === 'command' && m.action === 'set_env'),
    );
    expect(cmd.env).toEqual(next);

    // The API reflects the new env to the admin.
    const token = mintHs256({ sub: 'ad', roles: ['admin'], exp: future }, SECRET);
    const detail = (await (
      await fetch(`http://127.0.0.1:${port}/api/services/svc`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { env: unknown };
    expect(detail.env).toEqual(next);

    op.close();
    admin.close();
    agent.close();
  });

  it('authenticates a browser stream via the login session cookie', async () => {
    const SECRET = 'cookie-secret';
    cp = startControlPlane(testConfig({ oidcHs256Secret: SECRET }));
    const port = await cp.listening;
    const token = mintHs256({ sub: 'carol', roles: ['operator'], exp: future }, SECRET);

    // A valid session cookie authenticates the upgrade.
    const withCookie = new WebSocket(`ws://127.0.0.1:${port}/stream`, {
      headers: { Cookie: `fd_session=${token}` },
    });
    await expect(open(withCookie)).resolves.toBeUndefined();
    withCookie.close();

    // No credential at all is rejected when identity is on.
    const none = new WebSocket(`ws://127.0.0.1:${port}/stream`);
    await expect(open(none)).rejects.toBeTruthy();
  });
});
