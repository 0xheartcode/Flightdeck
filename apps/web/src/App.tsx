import { useState } from 'react';
import { ApiError } from '@/api';
import { useServices } from '@/hooks/useServices';
import { useMe } from '@/hooks/useMe';
import { useLogStream } from '@/hooks/useLogStream';
import { ServiceList } from '@/components/ServiceList';
import { LogViewer } from '@/components/LogViewer';
import { EnvPanel } from '@/components/EnvPanel';
import { TokenBar } from '@/components/TokenBar';

const isUnauthorized = (err: unknown): boolean => err instanceof ApiError && err.status === 401;

export function App() {
  const { data: me, error: meError } = useMe();
  const { data: services = [], isLoading, isError, error: servicesError } = useServices();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const {
    logs,
    connected,
    stats,
    status,
    actionResult,
    actionPending,
    deploy,
    sendAction,
    sendSetEnv,
  } = useLogStream(selectedId);

  // A 401 means identity is on but we are not signed in (the /api/me 401 hides
  // the identityEnabled flag until a valid token is supplied).
  const unauthorized = isUnauthorized(meError) || isUnauthorized(servicesError);
  const identityEnabled = me?.identityEnabled ?? unauthorized;
  const authenticated = identityEnabled ? Boolean(me?.subject) : true;
  const canAct = !identityEnabled || (me?.permissions.includes('act') ?? false);
  const canEdit = !identityEnabled || (me?.permissions.includes('reveal') ?? false);

  const selected = services.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
        <span className="text-lg font-semibold text-slate-100">Flightdeck</span>
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs font-medium text-slate-400">
          CD
        </span>
        <div className="ml-auto min-w-0">
          <TokenBar
            identityEnabled={identityEnabled}
            authenticated={authenticated}
            name={me?.name ?? me?.subject}
          />
        </div>
      </header>

      {/* Stacks on small screens (services on top, logs below), side by side from md up. */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="max-h-56 w-full shrink-0 overflow-auto border-b border-slate-800 md:max-h-none md:w-72 md:border-b-0 md:border-r">
          {isLoading ? (
            <p className="p-4 text-sm text-slate-500">Loading services...</p>
          ) : isError ? (
            <p className="p-4 text-sm text-rose-400">
              {unauthorized ? 'Sign in to view services.' : 'Control plane unreachable.'}
            </p>
          ) : (
            <ServiceList services={services} selectedId={selectedId} onSelect={setSelectedId} />
          )}
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selected ? (
            <>
              <EnvPanel
                serviceId={selected.id}
                canEdit={canEdit}
                onSave={sendSetEnv}
                actionResult={actionResult}
                actionPending={actionPending}
              />
              <div className="min-h-0 flex-1">
                <LogViewer
                  serviceName={selected.name}
                  logs={logs}
                  connected={connected}
                  stats={stats}
                  status={status}
                  actionResult={actionResult}
                  actionPending={actionPending}
                  deploy={deploy}
                  onAction={sendAction}
                  canAct={canAct}
                />
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-600">
              Select a service to view its logs.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
