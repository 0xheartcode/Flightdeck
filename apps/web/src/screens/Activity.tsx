import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAudit } from '@/api';
import {
  Badge,
  EmptyState,
  Icon,
  Select,
  Skeleton,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui';
import { relativeTime } from '@/lib/format';
import type { Route } from '@/lib/router';
import { Page, PageHeader } from './parts';

const ACTIONS = ['restart', 'redeploy', 'set_env'] as const;

export interface ActivityProps {
  onNavigate: (route: Route) => void;
}

/**
 * The operator audit trail (GET /api/audit): who did what, to which service, and
 * whether it succeeded. Security-relevant and strictly read-only — nothing here
 * can trigger an action; the only interaction is navigating to the target
 * service.
 */
export function Activity({ onNavigate }: ActivityProps) {
  const [action, setAction] = useState('');
  const [result, setResult] = useState('');
  const audit = useQuery({
    queryKey: ['audit'],
    queryFn: () => fetchAudit(500),
    refetchInterval: 10_000,
  });

  const rows = useMemo(() => {
    let list = audit.data ?? [];
    if (action) list = list.filter((a) => a.action === action);
    if (result) list = list.filter((a) => (result === 'ok' ? a.ok : !a.ok));
    return list;
  }, [audit.data, action, result]);

  return (
    <Page>
      <PageHeader
        title="Activity"
        subtitle="Every operator action Flightdeck has recorded, newest first."
        actions={
          <div className="flex items-center gap-2">
            <Select
              aria-label="Filter by action"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              options={[
                { value: '', label: 'All actions' },
                ...ACTIONS.map((a) => ({ value: a, label: a })),
              ]}
            />
            <Select
              aria-label="Filter by result"
              value={result}
              onChange={(e) => setResult(e.target.value)}
              options={[
                { value: '', label: 'All results' },
                { value: 'ok', label: 'Succeeded' },
                { value: 'fail', label: 'Failed' },
              ]}
            />
          </div>
        }
      />

      <div className="rounded-xl border border-line bg-surface">
        {audit.isError ? (
          <EmptyState
            icon="warning-octagon"
            tone="danger"
            title="Couldn't load activity"
            description="The control plane is unreachable. Retrying."
          />
        ) : audit.isLoading ? (
          <div className="flex flex-col gap-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="clock-counter-clockwise"
            title={audit.data?.length ? 'No entries match these filters' : 'No activity yet'}
            description={
              audit.data?.length
                ? 'Try clearing the filters.'
                : 'Operator actions (restart, redeploy, env changes) will appear here.'
            }
          />
        ) : (
          <Table label="Activity">
            <THead>
              <TH>Result</TH>
              <TH>Action</TH>
              <TH>Target</TH>
              <TH className="hidden sm:table-cell">Actor</TH>
              <TH className="text-right">When</TH>
            </THead>
            <TBody>
              {rows.map((a, i) => (
                <TR key={`${a.ts}-${i}`}>
                  <TD>
                    {a.ok ? (
                      <span className="inline-flex items-center gap-1 text-ok">
                        <Icon name="check-circle" size={16} label="Succeeded" />
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-danger" title={a.error}>
                        <Icon name="x-circle" size={16} label="Failed" />
                      </span>
                    )}
                  </TD>
                  <TD>
                    <Badge tone="neutral">{a.action}</Badge>
                  </TD>
                  <TD>
                    <button
                      type="button"
                      onClick={() => onNavigate({ name: 'service', id: a.serviceId })}
                      className="font-mono text-xs text-link hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                    >
                      {a.serviceId}
                    </button>
                  </TD>
                  <TD className="hidden text-xs text-muted sm:table-cell">{a.actor}</TD>
                  <TD
                    className="text-right text-xs text-faint"
                    title={new Date(a.ts).toLocaleString()}
                  >
                    {relativeTime(a.ts)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </Page>
  );
}
