import type { ServiceInfo } from '@flightdeck/protocol';
import type { ExposedService, HostExposure, PortMapping } from '@/api';
import { Badge, Card, EmptyState } from '@/components/ui';

/** A short host-port label for a published port, e.g. `:8080` or `127.0.0.1:5432`. */
export function portLabel(port: PortMapping): string {
  if (port.hostPort === undefined) return `${port.containerPort}/${port.protocol} (exposed)`;
  const host = port.hostIp && port.hostIp !== '0.0.0.0' && port.hostIp !== '::' ? port.hostIp : '';
  return `${host}:${port.hostPort} → ${port.containerPort}/${port.protocol}`;
}

/** The public host ports of a service, as compact `:port` labels (for summaries). */
export function publicPortLabels(ports: PortMapping[] | undefined): string[] {
  return (ports ?? [])
    .filter((p) => p.public && p.hostPort !== undefined)
    .map((p) => `:${p.hostPort}`);
}

function PublicPill({ isPublic }: { isPublic: boolean }) {
  return isPublic ? (
    <Badge tone="warn" dot>
      Public
    </Badge>
  ) : (
    <Badge tone="neutral">Localhost</Badge>
  );
}

/**
 * The per-service Exposure panel (Service detail → Exposure tab): how this
 * service is reachable. Read-only; derived from container metadata and labels.
 */
export function ServiceExposure({ service }: { service: ServiceInfo }) {
  const ports = service.ports ?? [];
  const networks = service.networks ?? [];
  const routes = service.routes ?? [];

  if (ports.length === 0 && networks.length === 0 && routes.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="plugs-connected"
          title="No exposure data"
          description="This service publishes no ports and carries no routing labels, or the agent predates exposure reporting."
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {routes.length > 0 ? (
        <Card>
          <div className="border-b border-line px-4 py-2.5 text-xs font-medium text-faint">
            Reachable at
          </div>
          <ul className="flex flex-col gap-1 px-4 py-3">
            {routes.map((r) => (
              <li key={r.domain} className="flex items-center gap-2 text-sm">
                <span className="font-mono text-fg">{r.domain}</span>
                {r.tls ? <Badge tone="ok">TLS</Badge> : null}
                <span className="text-xs text-faint">
                  {r.source === 'traefik-label' ? 'Traefik' : 'flightdeck'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <div className="border-b border-line px-4 py-2.5 text-xs font-medium text-faint">
          Published ports
        </div>
        {ports.length === 0 ? (
          <div className="px-4 py-3 text-sm text-muted">Not published to any host port.</div>
        ) : (
          <ul className="flex flex-col gap-1 px-4 py-3">
            {ports.map((p) => (
              <li
                key={`${p.containerPort}/${p.protocol}/${p.hostPort ?? 'x'}`}
                className={`flex items-center justify-between gap-2 text-sm ${
                  p.public ? '' : 'opacity-70'
                }`}
              >
                <span className="font-mono text-fg">{portLabel(p)}</span>
                <PublicPill isPublic={p.public} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {networks.length > 0 ? (
        <Card>
          <div className="border-b border-line px-4 py-2.5 text-xs font-medium text-faint">
            Docker networks
          </div>
          <ul className="flex flex-col gap-1 px-4 py-3">
            {networks.map((n) => (
              <li key={n.network} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-fg">{n.network}</span>
                <span className="font-mono text-xs text-muted">{n.ipAddress ?? '—'}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

/** Index exposure by host name and by service id, for the Hosts screen. */
export function indexExposure(hosts: HostExposure[]): {
  byHost: Map<string, HostExposure>;
  byServiceId: Map<string, ExposedService>;
} {
  const byHost = new Map<string, HostExposure>();
  const byServiceId = new Map<string, ExposedService>();
  for (const host of hosts) {
    byHost.set(host.host, host);
    for (const svc of host.services) byServiceId.set(svc.id, svc);
  }
  return { byHost, byServiceId };
}
