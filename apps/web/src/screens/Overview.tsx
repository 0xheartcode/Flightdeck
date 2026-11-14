import type { ServiceInfo } from '@flightdeck/protocol';
import {
  Button,
  EmptyState,
  Skeleton,
  StatusPill,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui';
import { relativeTime } from '@/lib/format';
import { byHost, needsAttention } from '@/lib/services';
import type { Route } from '@/lib/router';
import { Page, PageHeader, StatCard } from './parts';

export interface OverviewProps {
  services: ServiceInfo[];
  loading: boolean;
  error: boolean;
  onNavigate: (route: Route) => void;
  onConnectAgent: () => void;
}

export function Overview({ services, loading, error, onNavigate, onConnectAgent }: OverviewProps) {
  const running = services.filter((s) => s.state === 'running').length;
  const attention = services.filter((s) => needsAttention(s.state)).length;
  const hosts = byHost(services).length;

  return (
    <Page>
      <PageHeader
        title="Overview"
        subtitle="Every service Flightdeck is tracking across your hosts."
        actions={
          <Button icon="plugs-connected" onClick={onConnectAgent}>
            Connect agent
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Services" value={loading ? '—' : services.length} icon="cube" />
        <StatCard label="Running" value={loading ? '—' : running} icon="check-circle" tone="ok" />
        <StatCard
          label="Needs attention"
          value={loading ? '—' : attention}
          icon="warning"
          tone={attention > 0 ? 'danger' : undefined}
        />
        <StatCard label="Hosts" value={loading ? '—' : hosts} icon="hard-drives" />
      </div>

      <div className="rounded-xl border border-line bg-surface">
        {error ? (
          <EmptyState
            icon="warning-octagon"
            tone="danger"
            title="Couldn't reach the control plane"
            description="The service registry is unavailable. Retrying automatically."
          />
        ) : loading ? (
          <div className="flex flex-col gap-3 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : services.length === 0 ? (
          <EmptyState
            icon="cube"
            title="No services yet"
            description="Connect an agent on a host and label your containers to see them here."
            action={
              <Button icon="plugs-connected" onClick={onConnectAgent}>
                Connect agent
              </Button>
            }
          />
        ) : (
          <Table label="Services">
            <THead>
              <TH>Service</TH>
              <TH>Status</TH>
              <TH className="hidden sm:table-cell">Host</TH>
              <TH className="hidden md:table-cell">Repo</TH>
              <TH className="hidden lg:table-cell">Image</TH>
              <TH className="text-right">Created</TH>
            </THead>
            <TBody>
              {services.map((s) => (
                <TR key={s.id} onClick={() => onNavigate({ name: 'service', id: s.id })}>
                  <TD className="font-medium">{s.name}</TD>
                  <TD>
                    <StatusPill state={s.state} />
                  </TD>
                  <TD className="hidden text-muted sm:table-cell">{s.host}</TD>
                  <TD className="hidden md:table-cell">
                    {s.repo ? (
                      <span className="font-mono text-xs text-muted">{s.repo}</span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </TD>
                  <TD className="hidden lg:table-cell">
                    <span className="font-mono text-xs text-faint">{s.image}</span>
                  </TD>
                  <TD className="text-right text-xs text-faint">{relativeTime(s.createdAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </Page>
  );
}
