import type { ServiceInfo } from '@flightdeck/protocol';
import { cx } from '@/lib/format';
import { StatusBadge } from '@/components/StatusBadge';

interface Props {
  services: ServiceInfo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ServiceList({ services, selectedId, onSelect }: Props) {
  if (services.length === 0) {
    return (
      <p className="p-4 text-sm leading-relaxed text-slate-500">
        No services yet. Label a container with{' '}
        <code className="text-slate-400">flightdeck.enable=true</code> and start the agent on that
        host.
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
      {services.map((svc) => (
        <li key={svc.id}>
          <button
            type="button"
            onClick={() => onSelect(svc.id)}
            className={cx(
              'flex w-full flex-col gap-1 border-l-2 px-4 py-3 text-left transition-colors',
              selectedId === svc.id
                ? 'border-emerald-500 bg-slate-800/60'
                : 'border-transparent hover:bg-slate-800/30',
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="truncate font-medium text-slate-100">{svc.name}</span>
              <StatusBadge state={svc.state} />
            </span>
            <span className="truncate text-xs text-slate-500">{svc.image}</span>
            <span className="text-xs text-slate-600">{svc.host}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
