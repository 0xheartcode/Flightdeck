import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DeployStatus } from '@flightdeck/protocol';
import { fetchDeploys } from '@/api';
import {
  DeployStatusPill,
  EmptyState,
  Select,
  Skeleton,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui';
import { relativeTime, shortSha } from '@/lib/format';
import type { Route } from '@/lib/router';
import { Page, PageHeader } from './parts';

const STATUSES: DeployStatus[] = ['pending', 'in_progress', 'success', 'failure', 'cancelled'];

export interface DeploysProps {
  onNavigate: (route: Route) => void;
}

/**
 * Cross-service GitHub Actions timeline (GET /api/deploys). Filters by project
 * (= repo) and status. Deploys are repo-keyed, so the project filter maps to the
 * repo field; see COVERAGE.md.
 */
export function Deploys({ onNavigate }: DeploysProps) {
  const [repo, setRepo] = useState('');
  const [status, setStatus] = useState('');
  const deploys = useQuery({
    queryKey: ['deploys'],
    queryFn: () => fetchDeploys(undefined, 200),
    refetchInterval: 15_000,
  });

  const repos = useMemo(
    () => [...new Set((deploys.data ?? []).map((d) => d.repo))].sort(),
    [deploys.data],
  );

  const rows = useMemo(() => {
    let list = deploys.data ?? [];
    if (repo) list = list.filter((d) => d.repo === repo);
    if (status) list = list.filter((d) => d.status === status);
    return list;
  }, [deploys.data, repo, status]);

  return (
    <Page>
      <PageHeader
        title="Deploys"
        subtitle="GitHub Actions deployments correlated across every service."
        actions={
          <div className="flex items-center gap-2">
            <Select
              aria-label="Filter by project"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              options={[
                { value: '', label: 'All projects' },
                ...repos.map((r) => ({ value: r, label: r })),
              ]}
            />
            <Select
              aria-label="Filter by status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={[
                { value: '', label: 'All statuses' },
                ...STATUSES.map((s) => ({ value: s, label: s })),
              ]}
            />
          </div>
        }
      />

      <div className="rounded-xl border border-line bg-surface">
        {deploys.isError ? (
          <EmptyState
            icon="warning-octagon"
            tone="danger"
            title="Couldn't load deploys"
            description="The control plane is unreachable. Retrying."
          />
        ) : deploys.isLoading ? (
          <div className="flex flex-col gap-3 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="rocket-launch"
            title={deploys.data?.length ? 'No deploys match these filters' : 'No deploys yet'}
            description={
              deploys.data?.length
                ? 'Try clearing the project or status filter.'
                : 'GitHub Actions runs will appear here once a workflow reports in.'
            }
          />
        ) : (
          <Table label="Deploys">
            <THead>
              <TH>Project</TH>
              <TH>Status</TH>
              <TH className="hidden sm:table-cell">Commit</TH>
              <TH className="hidden md:table-cell">Branch</TH>
              <TH className="hidden lg:table-cell">Actor</TH>
              <TH className="text-right">Updated</TH>
            </THead>
            <TBody>
              {rows.map((d) => (
                <TR key={d.id}>
                  <TD>
                    <button
                      type="button"
                      onClick={() => onNavigate({ name: 'project', repo: d.repo })}
                      className="font-mono text-xs text-link hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                    >
                      {d.repo}
                    </button>
                  </TD>
                  <TD>
                    <DeployStatusPill status={d.status} />
                  </TD>
                  <TD className="hidden sm:table-cell">
                    {d.runUrl ? (
                      <a
                        href={d.runUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="font-mono text-xs text-link hover:underline"
                      >
                        {shortSha(d.sha)} ↗
                      </a>
                    ) : (
                      <span className="font-mono text-xs text-muted">{shortSha(d.sha)}</span>
                    )}
                  </TD>
                  <TD className="hidden md:table-cell">
                    <span className="font-mono text-xs text-muted">{d.branch ?? '—'}</span>
                  </TD>
                  <TD className="hidden text-xs text-muted lg:table-cell">{d.actor ?? '—'}</TD>
                  <TD className="text-right text-xs text-faint">{relativeTime(d.updatedAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </Page>
  );
}
