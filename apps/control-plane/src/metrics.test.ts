import { describe, expect, it } from 'vitest';
import { Metrics } from './metrics.js';

describe('Metrics', () => {
  it('renders gauges and counters in Prometheus text format', () => {
    const metrics = new Metrics();
    metrics.incLogLines(3);
    metrics.incAction('restart', true);
    metrics.incAction('restart', true);
    metrics.incAction('redeploy', false);

    const out = metrics.render({ agents: 1, services: 4 });
    expect(out).toContain('flightdeck_agents_connected 1');
    expect(out).toContain('flightdeck_services 4');
    expect(out).toContain('flightdeck_log_lines_total 3');
    expect(out).toContain('flightdeck_actions_total{action="restart",outcome="ok"} 2');
    expect(out).toContain('flightdeck_actions_total{action="redeploy",outcome="error"} 1');
  });
});
