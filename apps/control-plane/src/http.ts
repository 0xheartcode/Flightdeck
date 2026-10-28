import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Store } from './store.js';

/** REST surface consumed by the web UI (live log streaming is over WS). */
export function createHttpApp(store: Store): Hono {
  const app = new Hono();

  app.use('/api/*', cors());

  app.get('/api/health', (c) => c.json({ ok: true, version: '0.1.0' }));

  app.get('/api/services', (c) => c.json({ services: store.listServices() }));

  app.get('/api/services/:id', (c) => {
    const id = c.req.param('id');
    const service = store.getService(id);
    if (!service) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json({ service, logs: store.recentLogs(id) });
  });

  return app;
}
