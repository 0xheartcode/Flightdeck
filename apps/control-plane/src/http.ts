import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bearer, tokenOk } from './auth.js';
import type { Context } from './context.js';

/**
 * REST surface for the web UI plus a Prometheus metrics endpoint. Live log
 * streaming is over WebSocket, not here.
 */
export function createHttpApp(ctx: Context, agentCount: () => number): Hono {
  const { config, store, audit, metrics } = ctx;
  const app = new Hono();

  // Metrics are unauthenticated (counts only, no secrets) and outside /api so
  // the CORS and dashboard-token middleware below do not apply.
  app.get('/metrics', (c) =>
    c.text(metrics.render({ agents: agentCount(), services: store.listServices().length })),
  );

  app.use('/api/*', cors({ origin: config.corsOrigin }));

  // Optional bearer-token gate. When FD_DASHBOARD_TOKEN is set, every /api
  // request must present it; when unset, the API is open (dev mode, warned).
  if (config.dashboardToken) {
    app.use('/api/*', async (c, next) => {
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

  app.get('/api/audit', (c) => {
    const limit = Number(c.req.query('limit'));
    return c.json({ audit: audit.list(Number.isFinite(limit) && limit > 0 ? limit : undefined) });
  });

  return app;
}
