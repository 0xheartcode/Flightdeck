import { useState } from 'react';
import { useServices } from '@/hooks/useServices';
import { useLogStream } from '@/hooks/useLogStream';
import { ServiceList } from '@/components/ServiceList';
import { LogViewer } from '@/components/LogViewer';

export function App() {
  const { data: services = [], isLoading, isError } = useServices();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { logs, connected } = useLogStream(selectedId);

  const selected = services.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
        <span className="text-lg font-semibold text-slate-100">Flightdeck</span>
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs font-medium text-slate-400">
          CD
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-72 shrink-0 overflow-auto border-r border-slate-800">
          {isLoading ? (
            <p className="p-4 text-sm text-slate-500">Loading services...</p>
          ) : isError ? (
            <p className="p-4 text-sm text-rose-400">Control plane unreachable.</p>
          ) : (
            <ServiceList services={services} selectedId={selectedId} onSelect={setSelectedId} />
          )}
        </aside>

        <main className="min-w-0 flex-1">
          {selected ? (
            <LogViewer logs={logs} connected={connected} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-600">
              Select a service to view its logs.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
