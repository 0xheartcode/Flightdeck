import type { ServiceInfo, ServiceState } from '@flightdeck/protocol';

/** States that warrant operator attention (surfaced as the Overview badge). */
const ATTENTION: ReadonlySet<ServiceState> = new Set(['exited', 'dead', 'restarting', 'unknown']);

export function needsAttention(state: ServiceState): boolean {
  return ATTENTION.has(state);
}

export function isRunning(state: ServiceState): boolean {
  return state === 'running';
}

/** Group services by host, sorted by host name. */
export function byHost(services: ServiceInfo[]): Array<{ host: string; services: ServiceInfo[] }> {
  const map = new Map<string, ServiceInfo[]>();
  for (const s of services) {
    const list = map.get(s.host) ?? [];
    list.push(s);
    map.set(s.host, list);
  }
  return [...map.entries()]
    .map(([host, svcs]) => ({ host, services: svcs }))
    .sort((a, b) => a.host.localeCompare(b.host));
}

/** A "project" is the set of services that share a repo label. */
export function byRepo(services: ServiceInfo[]): Array<{ repo: string; services: ServiceInfo[] }> {
  const map = new Map<string, ServiceInfo[]>();
  for (const s of services) {
    if (!s.repo) continue;
    const list = map.get(s.repo) ?? [];
    list.push(s);
    map.set(s.repo, list);
  }
  return [...map.entries()]
    .map(([repo, svcs]) => ({ repo, services: svcs }))
    .sort((a, b) => a.repo.localeCompare(b.repo));
}

/** A host is "online" when it has at least one non-dead service reporting. */
export function hostOnline(services: ServiceInfo[]): boolean {
  return services.some((s) => s.state !== 'dead' && s.state !== 'exited');
}
