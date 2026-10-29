import { useEffect, useRef } from 'react';
import type { ActionKind, LogLine, Stats } from '@flightdeck/protocol';
import type { ActionResult, LiveStatus } from '@/hooks/useLogStream';
import { cx, formatBytes, formatTime } from '@/lib/format';

interface Props {
  serviceName: string;
  logs: LogLine[];
  connected: boolean;
  stats: Stats | null;
  status: LiveStatus | null;
  actionResult: ActionResult | null;
  actionPending: boolean;
  onAction: (action: ActionKind) => void;
}

export function LogViewer({
  serviceName,
  logs,
  connected,
  stats,
  status,
  actionResult,
  actionPending,
  onAction,
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const confirmAction = (action: ActionKind, prompt: string): void => {
    if (window.confirm(`${prompt} ${serviceName}?`)) {
      onAction(action);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-800 px-4 py-2 text-xs text-slate-400">
        <span className="flex items-center gap-2">
          <span
            className={cx('h-2 w-2 rounded-full', connected ? 'bg-emerald-500' : 'bg-rose-500')}
          />
          {connected ? 'live' : 'disconnected'}
        </span>
        {stats && (
          <span className="tabular-nums text-slate-500">
            CPU {stats.cpuPct.toFixed(1)}% · MEM {formatBytes(stats.memBytes)}
            {stats.memLimitBytes > 0 ? ` / ${formatBytes(stats.memLimitBytes)}` : ''}
          </span>
        )}
        {status?.state === 'exited' && status.exitCode !== undefined && (
          <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-300 tabular-nums">
            exit {status.exitCode}
          </span>
        )}
        {actionResult && (
          <span className={actionResult.ok ? 'text-emerald-400' : 'text-rose-400'}>
            {actionResult.ok
              ? `${actionResult.action} ok`
              : `${actionResult.action} failed: ${actionResult.error ?? 'error'}`}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => confirmAction('restart', 'Restart')}
            disabled={actionPending}
            className="rounded border border-slate-700 px-2 py-0.5 text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Restart
          </button>
          <button
            type="button"
            onClick={() => confirmAction('redeploy', 'Redeploy')}
            disabled={actionPending}
            className="rounded border border-slate-700 px-2 py-0.5 text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {actionPending ? 'working...' : 'Redeploy'}
          </button>
          <span className="tabular-nums">{logs.length} lines</span>
        </span>
      </div>
      <div className="flex-1 overflow-auto bg-[#07090d] p-4 font-mono text-xs leading-relaxed">
        {logs.length === 0 ? (
          <p className="text-slate-600">Waiting for logs...</p>
        ) : (
          logs.map((l, i) => (
            <div key={i} className="flex gap-3 whitespace-pre-wrap break-all">
              <span className="shrink-0 text-slate-600">{formatTime(l.ts)}</span>
              <span className={l.stream === 'stderr' ? 'text-rose-400' : 'text-slate-200'}>
                {l.line}
              </span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
