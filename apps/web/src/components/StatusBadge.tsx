import type { ServiceState } from '@flightdeck/protocol';
import { cx } from '@/lib/format';

const COLORS: Record<ServiceState, string> = {
  running: 'bg-emerald-500',
  restarting: 'bg-amber-500',
  paused: 'bg-sky-500',
  created: 'bg-slate-500',
  exited: 'bg-rose-500',
  dead: 'bg-rose-700',
  removing: 'bg-slate-600',
  unknown: 'bg-slate-500',
};

export function StatusBadge({ state }: { state: ServiceState }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-300">
      <span className={cx('h-2 w-2 rounded-full', COLORS[state])} />
      {state}
    </span>
  );
}
