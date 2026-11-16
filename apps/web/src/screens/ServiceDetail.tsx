import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchServiceDetail } from '@/api';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DeployStatusPill,
  EmptyState,
  LogViewer,
  Meter,
  StatusPill,
  Tabs,
  useToast,
} from '@/components/ui';
import { useLogStream } from '@/hooks/useLogStream';
import { usePermissions } from '@/hooks/usePermissions';
import { formatBytes, relativeTime, shortSha } from '@/lib/format';
import type { Route } from '@/lib/router';
import { EnvPanel } from './ServiceEnv';
import { ServiceExposure } from './Exposure';
import { LogSearchPanel } from './LogSearch';
import { Page, PageHeader } from './parts';

export interface ServiceDetailProps {
  serviceId: string;
  onNavigate: (route: Route) => void;
  logSearchEnabled: boolean;
}

export function ServiceDetail({ serviceId, onNavigate, logSearchEnabled }: ServiceDetailProps) {
  const perms = usePermissions();
  const toast = useToast();
  const detail = useQuery({
    queryKey: ['service', serviceId],
    queryFn: () => fetchServiceDetail(serviceId),
    refetchInterval: 10_000,
  });
  const stream = useLogStream(serviceId);
  const [tab, setTab] = useState('logs');
  const [logMode, setLogMode] = useState<'tail' | 'history'>('tail');
  const [confirm, setConfirm] = useState<null | 'restart' | 'redeploy'>(null);

  // Surface action outcomes as toasts (the server is authoritative).
  useEffect(() => {
    if (!stream.actionResult) return;
    const { action, ok, error } = stream.actionResult;
    if (ok) toast.success(`${action} succeeded`);
    else toast.error(`${action} failed${error ? `: ${error}` : ''}`);
  }, [stream.actionResult, toast]);

  const service = detail.data?.service;
  const liveState = stream.status?.state ?? service?.state;

  const restart = perms.can('restart');
  const redeploy = perms.can('redeploy');

  const logRows = useMemo(
    () => stream.logs.map((l) => ({ ts: l.ts, stream: l.stream, line: l.line })),
    [stream.logs],
  );

  if (detail.isLoading) {
    return (
      <Page>
        <PageHeader
          title={serviceId}
          back={{ label: 'Overview', onClick: () => onNavigate({ name: 'overview' }) }}
        />
        <Card>
          <EmptyState icon="circle-notch" title="Loading service…" />
        </Card>
      </Page>
    );
  }

  if (detail.isError || !service) {
    return (
      <Page>
        <PageHeader
          title={serviceId}
          back={{ label: 'Overview', onClick: () => onNavigate({ name: 'overview' }) }}
        />
        <Card>
          <EmptyState
            icon="warning-octagon"
            tone="danger"
            title="Service not found"
            description="It may have been removed, or the control plane is unreachable."
          />
        </Card>
      </Page>
    );
  }

  const tabs = [
    { id: 'logs', label: 'Logs' },
    { id: 'exposure', label: 'Exposure' },
    { id: 'env', label: 'Environment' },
    { id: 'deploy', label: 'Deploy' },
  ];

  return (
    <Page>
      <PageHeader
        back={{ label: 'Overview', onClick: () => onNavigate({ name: 'overview' }) }}
        title={
          <span className="flex items-center gap-2.5">
            {service.name}
            {liveState ? <StatusPill state={liveState} /> : null}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs">
            <span>{service.image}</span>
            <span className="text-faint">on {service.host}</span>
            {service.repo ? (
              <button
                type="button"
                onClick={() => onNavigate({ name: 'project', repo: service.repo! })}
                className="text-link hover:underline"
              >
                {service.repo}
              </button>
            ) : null}
            {service.environment ? <Badge tone="info">{service.environment}</Badge> : null}
          </span>
        }
        actions={
          <>
            <Button
              icon="arrow-clockwise"
              disabled={!restart.enabled || stream.actionPending}
              reason={restart.reason}
              onClick={() => setConfirm('restart')}
            >
              Restart
            </Button>
            <Button
              icon="rocket-launch"
              disabled={!redeploy.enabled || stream.actionPending}
              reason={redeploy.reason}
              onClick={() => setConfirm('redeploy')}
            >
              Redeploy
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card>
          <div className="px-4 py-3">
            <div className="mb-2 text-xs font-medium text-faint">CPU</div>
            <Meter
              label="CPU"
              value={stream.stats ? stream.stats.cpuPct : NaN}
              max={100}
              display={stream.stats ? `${stream.stats.cpuPct.toFixed(0)}%` : '—'}
            />
          </div>
        </Card>
        <Card>
          <div className="px-4 py-3">
            <div className="mb-2 text-xs font-medium text-faint">Memory</div>
            <Meter
              label="Memory"
              value={stream.stats ? stream.stats.memBytes : NaN}
              max={stream.stats ? stream.stats.memLimitBytes : 100}
              display={stream.stats ? `${formatBytes(stream.stats.memBytes)}` : '—'}
            />
          </div>
        </Card>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} label="Service sections" />
      <div className="mt-4">
        {tab === 'logs' ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              {logSearchEnabled ? (
                <div
                  role="tablist"
                  aria-label="Log mode"
                  className="inline-flex rounded-lg border border-line bg-sunken p-0.5 text-sm"
                >
                  {(
                    [
                      ['tail', 'Live tail'],
                      ['history', 'History'],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      role="tab"
                      type="button"
                      aria-selected={logMode === mode}
                      onClick={() => setLogMode(mode)}
                      className={`rounded-md px-3 py-1 font-medium transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
                        logMode === mode
                          ? 'bg-surface text-fg shadow-[var(--segsh)]'
                          : 'text-muted hover:text-fg'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : (
                <span />
              )}
              {logMode === 'tail' && !stream.connected ? (
                <Badge tone="warn" dot>
                  Live stream connecting…
                </Badge>
              ) : null}
            </div>
            {logMode === 'history' && logSearchEnabled ? (
              <LogSearchPanel serviceId={serviceId} />
            ) : (
              <LogViewer
                rows={logRows}
                className="h-[48vh]"
                empty={{
                  title: 'No log lines yet',
                  description: 'New output will appear here live.',
                }}
              />
            )}
          </div>
        ) : null}
        {tab === 'exposure' ? <ServiceExposure service={service} /> : null}
        {tab === 'env' ? (
          <EnvPanel
            serviceId={serviceId}
            env={detail.data?.env}
            canReveal={perms.has('reveal')}
            editState={perms.can('edit_env')}
            onSetEnv={stream.sendSetEnv}
            pending={stream.actionPending}
          />
        ) : null}
        {tab === 'deploy' ? (
          <Card>
            {detail.data?.deploy ? (
              <div className="flex flex-col gap-3 px-4 py-4 text-sm">
                <div className="flex items-center gap-2">
                  <DeployStatusPill status={detail.data.deploy.status} />
                  <span className="font-mono text-xs text-muted">
                    {shortSha(detail.data.deploy.sha)}
                  </span>
                  {detail.data.deploy.branch ? (
                    <Badge tone="neutral">{detail.data.deploy.branch}</Badge>
                  ) : null}
                </div>
                <div className="text-xs text-faint">
                  {detail.data.deploy.actor ? `by ${detail.data.deploy.actor} · ` : ''}
                  updated {relativeTime(detail.data.deploy.updatedAt)}
                </div>
                {detail.data.deploy.runUrl ? (
                  <a
                    href={detail.data.deploy.runUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex w-fit items-center gap-1 text-xs text-link hover:underline"
                  >
                    View run ↗
                  </a>
                ) : null}
              </div>
            ) : (
              <EmptyState
                icon="rocket-launch"
                title="No deploys recorded"
                description="GitHub Actions runs for this service's repo will appear here once correlated."
              />
            )}
          </Card>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        busy={stream.actionPending}
        danger={confirm === 'redeploy'}
        title={confirm === 'restart' ? 'Restart this service?' : 'Redeploy this service?'}
        description={
          confirm === 'restart'
            ? `The ${service.name} container will be restarted.`
            : `${service.name} will be recreated from its current image.`
        }
        confirmLabel={confirm === 'restart' ? 'Restart' : 'Redeploy'}
        onConfirm={() => {
          if (confirm) stream.sendAction(confirm);
          setConfirm(null);
        }}
      />
    </Page>
  );
}
