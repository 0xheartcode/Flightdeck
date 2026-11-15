import type { Hono } from 'hono';
import type { Context } from '../context.js';
import type { Permission, Principal } from '../identity.js';
import { logger } from '../logger.js';
import { AgentTokenInput } from './types.js';

const log = logger.child({ component: 'agent-tokens-audit' });

type Env = { Variables: { auth: { principal?: Principal; perms: Set<Permission> } } };

/**
 * Mount the managed agent-token API under /api/agent-tokens. Reads need an
 * authenticated caller (the shared /api middleware); every mutation needs the
 * admin tier (`reveal`), since issuing an agent credential widens who can
 * connect an agent. Secrets are returned once at issue/rotate and never again.
 */
export function registerAgentTokens(app: Hono<Env>, ctx: Context): void {
  const store = ctx.agentTokens;
  if (!store) return;

  const actor = (c: { get: (k: 'auth') => { principal?: Principal } }): string =>
    c.get('auth').principal?.subject ?? c.get('auth').principal?.name ?? 'dashboard';
  const isAdmin = (c: { get: (k: 'auth') => { perms: Set<Permission> } }): boolean =>
    c.get('auth').perms.has('reveal');
  const audit = (action: string, target: string, who: string): void => {
    log.info({ action, target, actor: who }, 'agent-token admin');
  };

  app.get('/api/agent-tokens', (c) => {
    if (!isAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    return c.json({ tokens: store.list() });
  });

  app.post('/api/agent-tokens', async (c) => {
    if (!isAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    const parsed = AgentTokenInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid name' }, 400);
    const issued = store.create(parsed.data.name);
    audit('token.create', issued.token.id, actor(c));
    return c.json(issued, 201);
  });

  app.post('/api/agent-tokens/:id/rotate', (c) => {
    if (!isAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    const rotated = store.rotate(c.req.param('id'));
    if (!rotated) return c.json({ error: 'not_found' }, 404);
    audit('token.rotate', rotated.token.id, actor(c));
    return c.json(rotated);
  });

  app.post('/api/agent-tokens/:id/revoke', (c) => {
    if (!isAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    if (!store.revoke(c.req.param('id'))) return c.json({ error: 'not_found' }, 404);
    audit('token.revoke', c.req.param('id'), actor(c));
    return c.body(null, 204);
  });

  app.delete('/api/agent-tokens/:id', (c) => {
    if (!isAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    if (!store.delete(c.req.param('id'))) return c.json({ error: 'not_found' }, 404);
    audit('token.delete', c.req.param('id'), actor(c));
    return c.body(null, 204);
  });
}
