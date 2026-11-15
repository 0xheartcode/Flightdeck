import { describe, expect, it } from 'vitest';
import { AuditLog } from '../audit.js';
import { nullBus } from '../bus.js';
import { CommandBus } from '../commands.js';
import { testConfig } from '../config.testutil.js';
import type { Context } from '../context.js';
import { SqliteDeployStore } from '../deploys.js';
import { createHttpApp } from '../http.js';
import { Metrics } from '../metrics.js';
import { Store } from '../store.js';
import { UserStore } from './store.js';

const SECRET = 'users-routes-secret';

function makeApp(users: UserStore) {
  const ctx: Context = {
    config: testConfig({ localUsersEnabled: true, sessionSecret: SECRET, dashboardToken: '' }),
    store: new Store(10),
    commands: new CommandBus(1000),
    audit: new AuditLog(50),
    metrics: new Metrics(),
    deploys: new SqliteDeployStore(),
    bus: nullBus,
    users,
  };
  return createHttpApp(ctx, () => 0);
}

/** Log in and return the fd_local session cookie value. */
async function login(app: ReturnType<typeof makeApp>, username: string, password: string) {
  const res = await app.request('/auth/local/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = /fd_local=([^;]+)/.exec(setCookie);
  return { status: res.status, cookie: match ? `fd_local=${match[1]}` : '' };
}

describe('users routes', () => {
  it('requires auth once local users are enabled', async () => {
    const users = new UserStore();
    users.create('admin', 'admin password x', ['admin']);
    const res = await makeApp(users).request('/api/services');
    expect(res.status).toBe(401);
  });

  it('logs in a valid user and rejects bad credentials', async () => {
    const users = new UserStore();
    users.create('admin', 'admin password x', ['admin']);
    const app = makeApp(users);
    expect((await login(app, 'admin', 'wrong')).status).toBe(401);
    const ok = await login(app, 'admin', 'admin password x');
    expect(ok.status).toBe(200);
    expect(ok.cookie).toContain('fd_local=');
    // The session authenticates subsequent API calls.
    const me = await app.request('/api/me', { headers: { cookie: ok.cookie } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ localUsers: true, roles: ['admin'] });
  });

  it('lets an admin list and create users without exposing hashes', async () => {
    const users = new UserStore();
    users.create('admin', 'admin password x', ['admin']);
    const app = makeApp(users);
    const { cookie } = await login(app, 'admin', 'admin password x');

    const created = await app.request('/api/users', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'lea', password: 'lea password xx', roles: ['operator'] }),
    });
    expect(created.status).toBe(201);

    const list = await app.request('/api/users', { headers: { cookie } });
    const body = (await list.json()) as { users: unknown[] };
    expect(body.users).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain('scrypt$');
    expect(JSON.stringify(body)).not.toContain('password');
  });

  it('forbids a viewer from managing users', async () => {
    const users = new UserStore();
    users.create('admin', 'admin password x', ['admin']);
    users.create('bob', 'bob password xxx', ['viewer']);
    const app = makeApp(users);
    const { cookie } = await login(app, 'bob', 'bob password xxx');
    const res = await app.request('/api/users', { headers: { cookie } });
    expect(res.status).toBe(403);
  });

  it('refuses to remove the last admin', async () => {
    const users = new UserStore();
    const admin = users.create('admin', 'admin password x', ['admin']);
    const app = makeApp(users);
    const { cookie } = await login(app, 'admin', 'admin password x');

    const demote = await app.request(`/api/users/${admin.id}`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ roles: ['viewer'] }),
    });
    expect(demote.status).toBe(409);

    const del = await app.request(`/api/users/${admin.id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(del.status).toBe(409);
  });
});
