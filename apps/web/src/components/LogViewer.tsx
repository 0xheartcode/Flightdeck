import { useEffect, useRef } from 'react';
import type { LogLine } from '@flightdeck/protocol';
import { cx, formatTime } from '@/lib/format';

interface Props {
  logs: LogLine[];
  connected: boolean;
}

export function LogViewer({ logs, connected }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-2 text-xs text-slate-400">
        <span
          className={cx('h-2 w-2 rounded-full', connected ? 'bg-emerald-500' : 'bg-rose-500')}
        />
        {connected ? 'live' : 'disconnected'}
        <span className="ml-auto tabular-nums">{logs.length} lines</span>
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
