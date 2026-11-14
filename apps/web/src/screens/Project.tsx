import type { ServiceInfo } from '@flightdeck/protocol';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  StatusPill,
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

export interface ProjectProps {
  repo: string;
  services: ServiceInfo[];
  onNavigate: (route: Route) => void;
}

/**
 * A "project" is the set of services sharing a repo label (there is no project
 * entity in the API; see COVERAGE.md). Groups this repo's services by
 * environment and links out to its deploy timeline.
 */
export function Project({ repo, services, onNavigate }: ProjectProps) {
  const mine = services.filter((s) => s.repo === repo);
  const environments = [...new Set(mine.map((s) => s.environment ?? 'default'))].sort();

  return (
    <Page>
      <PageHeader
        back={{ label: 'Overview', onClick: () => onNavigate({ name: 'overview' }) }}
        title={<span className="font-mono">{repo}</span>}
        subtitle={`${mine.length} service${mine.length === 1 ? '' : 's'} across ${environments.length} environment${environments.length === 1 ? '' : 's'}`}
        actions={
          <Button icon="rocket-launch" onClick={() => onNavigate({ name: 'deploys' })}>
            Deploys
          </Button>
        }
      />

      {mine.length === 0 ? (
        <Card>
          <EmptyState
            icon="folder-simple"
            title="No services for this repo"
            description="Nothing is labelled with this repo right now."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {environments.map((env) => {
            const svcs = mine.filter((s) => (s.environment ?? 'default') === env);
            return (
              <Card key={env}>
                <div className="flex items-center gap-2 border-b border-line px-4 py-3">
                  <Badge tone="info">{env}</Badge>
                  <span className="text-xs text-faint">
                    {svcs.length} service{svcs.length === 1 ? '' : 's'}
                  </span>
                </div>
                <Table label={`${env} services`}>
                  <THead>
                    <TH>Service</TH>
                    <TH>Status</TH>
                    <TH className="hidden sm:table-cell">Host</TH>
                    <TH className="text-right">Created</TH>
                  </THead>
                  <TBody>
                    {svcs.map((s) => (
                      <TR key={s.id} onClick={() => onNavigate({ name: 'service', id: s.id })}>
                        <TD className="font-medium">{s.name}</TD>
                        <TD>
                          <StatusPill state={s.state} />
                        </TD>
                        <TD className="hidden text-muted sm:table-cell">{s.host}</TD>
                        <TD className="text-right text-xs text-faint">
                          {relativeTime(s.createdAt)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </Card>
            );
          })}
        </div>
      )}
    </Page>
  );
}
