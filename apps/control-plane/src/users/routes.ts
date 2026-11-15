import type { Hono } from 'hono';
import type { Context } from '../context.js';
import type { Permission, Principal } from '../identity.js';
import { logger } from '../logger.js';
import { cookie } from '../oidclogin.js';
import { issueLocalSession, LOCAL_SESSION_COOKIE, LOCAL_SESSION_MAX_AGE } from './session.js';
import { CreateUserInput, LoginInput, SetPasswordInput, UpdateUserInput } from './types.js';

const log = logger.child({ component: 'users-audit' });

type Env = { Variables: { auth: { principal?: Principal; perms: Set<Permission> } } };

/**
 * Mount the local-user API.
 *
 * - POST /auth/local/login, /auth/local/logout live OUTSIDE /api (they must be
 *   reachable before a session exists). Login verifies a password and sets a
 *   signed session cookie; logout clears it.
 * - /api/users/* admin CRUD is gated by the admin tier (`reveal`). A guard keeps
 *   an operator from disabling, demoting or deleting the last enabled admin, so
 *   the instance can never be locked out of its own user management.
 */
export function registerUsers(app: Hono<Env>, ctx: Context, secureCookies: boolean): void {
  const store = ctx.users;
  if (!store) return;
  const secret = ctx.config.sessionSecret;

  const actor = (c: { get: (k: 'auth') => { principal?: Principal } }): string =>
    c.get('auth').principal?.subject ?? c.get('auth').principal?.name ?? 'dashboard';
  const isAdmin = (c: { get: (k: 'auth') => { perms: Set<Permission> } }): boolean =>
    c.get('auth').perms.has('reveal');
  const audit = (action: string, target: string, who: string): void => {
    log.info({ action, target, actor: who }, 'user admin');
  };

  // --- local login / logout (unauthenticated) ---
  app.post('/auth/local/login', async (c) => {
    if (!secret) return c.json({ error: 'local login not configured' }, 503);
    const parsed = LoginInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid credentials' }, 400);
    const user = store.verifyCredentials(parsed.data.username, parsed.data.password);
    if (!user) {
      log.warn({ username: parsed.data.username }, 'failed local login');
      return c.json({ error: 'invalid credentials' }, 401);
    }
    store.touchLogin(user.id);
    audit('login', user.username, user.username);
    c.header(
      'Set-Cookie',
      cookie(LOCAL_SESSION_COOKIE, issueLocalSession(secret, user.id), {
        maxAge: LOCAL_SESSION_MAX_AGE,
        secure: secureCookies,
      }),
    );
    return c.json({ ok: true, user });
  });

  app.post('/auth/local/logout', (c) => {
    c.header('Set-Cookie', cookie(LOCAL_SESSION_COOKIE, '', { maxAge: 0, secure: secureCookies }));
    return c.json({ ok: true });
  });

  // --- admin CRUD ---
  app.get('/api/users', (c) => {
    if (!isAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    return c.json({ users: store.list() });
  });

  app.post('/api/users', async (c) => {
    if (!isAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    const parsed = CreateUserInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid user', issues: parsed.error.issues }, 400);
    if (store.getByUsername(parsed.data.username)) {
      return c.json({ error: 'username already taken' }, 409);
    }
    const user = store.create(parsed.data.username, parsed.data.password, parsed.data.roles);
    audit('user.create', user.username, actor(c));
    return c.json({ user }, 201);
  });

  app.patch('/api/users/:id', async (c) => {
    if (!isAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    const id = c.req.param('id');
    const target = store.get(id);
    if (!target) return c.json({ error: 'not_found' }, 404);
    const parsed = UpdateUserInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid update' }, 400);

    // Guard against locking out the last admin.
    const losingAdmin =
      target.roles.includes('admin') &&
      ((parsed.data.roles && !parsed.data.roles.includes('admin')) ||
        parsed.data.disabled === true);
    if (losingAdmin && !target.disabled && store.enabledAdminCount <= 1) {
      return c.json({ error: 'cannot remove the last admin' }, 409);
    }

    let user = target;
    if (parsed.data.roles) user = store.setRoles(id, parsed.data.roles) ?? user;
    if (parsed.data.disabled !== undefined)
      user = store.setDisabled(id, parsed.data.disabled) ?? user;
    audit('user.update', user.username, actor(c));
    return c.json({ user });
  });

  app.post('/api/users/:id/password', async (c) => {
    if (!isAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    const id = c.req.param('id');
    const target = store.get(id);
    if (!target) return c.json({ error: 'not_found' }, 404);
    const parsed = SetPasswordInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'password too short', issues: parsed.error.issues }, 400);
    store.setPassword(id, parsed.data.password);
    audit('user.password', target.username, actor(c));
    return c.body(null, 204);
  });

  app.delete('/api/users/:id', (c) => {
    if (!isAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    const id = c.req.param('id');
    const target = store.get(id);
    if (!target) return c.json({ error: 'not_found' }, 404);
    if (target.roles.includes('admin') && !target.disabled && store.enabledAdminCount <= 1) {
      return c.json({ error: 'cannot remove the last admin' }, 409);
    }
    store.delete(id);
    audit('user.delete', target.username, actor(c));
    return c.body(null, 204);
  });
}
