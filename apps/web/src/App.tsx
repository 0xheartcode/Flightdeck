import { useState } from 'react';
import { useServices } from '@/hooks/useServices';
import { useLogStream } from '@/hooks/useLogStream';
import { ServiceList } from '@/components/ServiceList';
import { LogViewer } from '@/components/LogViewer';

export function App() {
  const { data: services = [], isLoading, isError } = useServices();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { logs, connected, stats, status, actionResult, actionPending, sendAction } =
    useLogStream(selectedId);

  const selected = services.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
        <span className="text-lg font-semibold text-slate-100">Flightdeck</span>
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs font-medium text-slate-400">
          CD
        </span>
      </header>

      {/* Stacks on small screens (services on top, logs below), side by side from md up. */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="max-h-56 w-full shrink-0 overflow-auto border-b border-slate-800 md:max-h-none md:w-72 md:border-b-0 md:border-r">
          {isLoading ? (
            <p className="p-4 text-sm text-slate-500">Loading services...</p>
          ) : isError ? (
            <p className="p-4 text-sm text-rose-400">Control plane unreachable.</p>
          ) : (
            <ServiceList services={services} selectedId={selectedId} onSelect={setSelectedId} />
          )}
        </aside>

        <main className="min-h-0 min-w-0 flex-1">
          {selected ? (
            <LogViewer
              serviceName={selected.name}
              logs={logs}
              connected={connected}
              stats={stats}
              status={status}
              actionResult={actionResult}
              actionPending={actionPending}
              onAction={sendAction}
            />
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
