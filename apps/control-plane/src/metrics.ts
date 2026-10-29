/**
 * Minimal Prometheus-style metrics. Counters live here; gauges that reflect
 * live state (connected agents, tracked services) are passed in at render
 * time so they are always current.
 */
export class Metrics {
  private logLines = 0;
  private readonly actions = new Map<string, number>();
  private readonly deploys = new Map<string, number>();

  incLogLines(n = 1): void {
    this.logLines += n;
  }

  incAction(action: string, ok: boolean): void {
    const key = `${action}:${ok ? 'ok' : 'error'}`;
    this.actions.set(key, (this.actions.get(key) ?? 0) + 1);
  }

  incDeploy(status: string): void {
    this.deploys.set(status, (this.deploys.get(status) ?? 0) + 1);
  }

  render(gauges: { agents: number; services: number }): string {
    const lines: string[] = [
      '# HELP flightdeck_agents_connected Connected agents',
      '# TYPE flightdeck_agents_connected gauge',
      `flightdeck_agents_connected ${gauges.agents}`,
      '# HELP flightdeck_services Tracked services',
      '# TYPE flightdeck_services gauge',
      `flightdeck_services ${gauges.services}`,
      '# HELP flightdeck_log_lines_total Log lines ingested from agents',
      '# TYPE flightdeck_log_lines_total counter',
      `flightdeck_log_lines_total ${this.logLines}`,
      '# HELP flightdeck_actions_total Operator actions dispatched',
      '# TYPE flightdeck_actions_total counter',
    ];
    for (const [key, value] of this.actions) {
      const [action, outcome] = key.split(':');
      lines.push(`flightdeck_actions_total{action="${action}",outcome="${outcome}"} ${value}`);
    }
    lines.push('# HELP flightdeck_deploys_total Deployments observed from CI');
    lines.push('# TYPE flightdeck_deploys_total counter');
    for (const [status, value] of this.deploys) {
      lines.push(`flightdeck_deploys_total{status="${status}"} ${value}`);
    }
    return lines.join('\n') + '\n';
  }
}
