import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Config } from './config.js';
import { bearer, tokenOk } from './auth.js';
import type { Store } from './store.js';

/** REST surface consumed by the web UI (live log streaming is over WS). */
export function createHttpApp(store: Store, config: Config): Hono {
  const app = new Hono();

  app.use('/api/*', cors({ origin: config.corsOrigin }));

  // Optional bearer-token gate. When FD_DASHBOARD_TOKEN is set, every /api
  // request must present it; when unset, the API is open (dev mode, warned).
  if (config.dashboardToken) {
    app.use('/api/*', async (c, next) => {
      // Allow CORS preflight through without auth.
      if (c.req.method === 'OPTIONS') return next();
      if (!tokenOk(config.dashboardToken, bearer(c.req.header('authorization')))) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      return next();
    });
  }

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
