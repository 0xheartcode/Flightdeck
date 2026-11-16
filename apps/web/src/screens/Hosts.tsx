import type { ServiceInfo } from '@flightdeck/protocol';
import { useQuery } from '@tanstack/react-query';
import { fetchExposure } from '@/api';
import { Badge, Card, EmptyState, Skeleton, StatusPill } from '@/components/ui';
import { byHost, hostOnline } from '@/lib/services';
import type { Route } from '@/lib/router';
import { indexExposure, publicPortLabels } from './Exposure';
import { Page, PageHeader } from './parts';

export interface HostsProps {
  services: ServiceInfo[];
  loading: boolean;
  error: boolean;
  onNavigate: (route: Route) => void;
}

/**
 * Hosts are derived from the `host` field on each service (there is no host-level
 * API; see COVERAGE.md). Each card groups a host's services and marks it online
 * when any service is live.
 */
export function Hosts({ services, loading, error, onNavigate }: HostsProps) {
  const groups = byHost(services);
  // Exposure is a separate, best-effort read: the host grid still renders if it
  // fails or is still loading (the public IP and reachability simply stay hidden).
  const exposure = useQuery({
    queryKey: ['exposure'],
    queryFn: fetchExposure,
    refetchInterval: 15_000,
  });
  const { byHost: hostExposure, byServiceId } = indexExposure(exposure.data ?? []);

  return (
    <Page>
      <PageHeader title="Hosts" subtitle="Servers running a Flightdeck agent, grouped by host." />

      {error ? (
        <Card>
          <EmptyState
            icon="warning-octagon"
            tone="danger"
            title="Control plane unreachable"
            description="Retrying automatically."
          />
        </Card>
      ) : loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState
            icon="hard-drives"
            title="No hosts yet"
            description="Connect an agent to see the hosts it runs on."
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map(({ host, services: svcs }) => {
            const online = hostOnline(svcs);
            const running = svcs.filter((s) => s.state === 'running').length;
            const publicIp = hostExposure.get(host)?.publicIp;
            return (
              <Card key={host}>
                <div className="flex items-center justify-between border-b border-line px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={`h-2 w-2 rounded-full ${online ? 'bg-ok' : 'bg-muted'}`}
                    />
                    <div className="flex flex-col">
                      <span className="font-mono text-sm font-medium text-fg">{host}</span>
                      {publicIp ? (
                        <span className="font-mono text-[11px] text-faint">{publicIp}</span>
                      ) : null}
                    </div>
                  </div>
                  <Badge tone={online ? 'ok' : 'neutral'} dot>
                    {online ? 'online' : 'offline'}
                  </Badge>
                </div>
                <div className="px-4 py-3">
                  <div className="mb-2 text-xs text-faint">
                    {running}/{svcs.length} running
                  </div>
                  <ul className="flex flex-col gap-1">
                    {svcs.map((s) => {
                      const ex = byServiceId.get(s.id);
                      const domain = ex?.routes[0]?.domain;
                      const ports = publicPortLabels(ex?.ports);
                      const reach = [domain, ...ports].filter(Boolean).join(' · ');
                      return (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => onNavigate({ name: 'service', id: s.id })}
                            className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-row focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                          >
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate text-fg">{s.name}</span>
                              {reach ? (
                                <span className="truncate font-mono text-[11px] text-faint">
                                  {reach}
                                </span>
                              ) : null}
                            </span>
                            <StatusPill state={s.state} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Page>
  );
}
