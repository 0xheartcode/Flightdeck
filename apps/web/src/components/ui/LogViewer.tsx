import { useEffect, useLayoutEffect, useRef } from 'react';
import { EmptyState } from './EmptyState';

export interface LogRow {
  ts: number;
  stream: 'stdout' | 'stderr' | string;
  line: string;
}

export interface LogViewerProps {
  rows: LogRow[];
  /** Follow the tail: scroll to bottom as rows arrive (unless the user scrolled up). */
  follow?: boolean;
  /** Shown when there are no rows. */
  empty?: { title: string; description?: string };
  /** Max rows to render; older rows are dropped from the DOM for performance. */
  cap?: number;
  className?: string;
}

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour12: false });
  } catch {
    return '';
  }
}

/**
 * A monospace log pane. stderr lines are tinted. When `follow` is set it keeps
 * the newest line in view, but only while the user is already near the bottom, so
 * scrolling up to read history is not yanked back.
 */
export function LogViewer({
  rows,
  follow = true,
  empty,
  cap = 2000,
  className = '',
}: LogViewerProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  useLayoutEffect(() => {
    if (!follow || !pinned.current) return;
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows, follow]);

  useEffect(() => {
    pinned.current = true;
  }, []);

  if (rows.length === 0 && empty) {
    return (
      <div className={`rounded-lg border border-line bg-codebg ${className}`}>
        <EmptyState icon="list" title={empty.title} description={empty.description} />
      </div>
    );
  }

  const shown = rows.length > cap ? rows.slice(rows.length - cap) : rows;

  return (
    <div
      ref={boxRef}
      onScroll={onScroll}
      role="log"
      aria-live="off"
      className={`overflow-auto rounded-lg border border-line bg-codebg p-3 font-mono text-xs leading-relaxed ${className}`}
    >
      {shown.map((r, i) => (
        <div key={i} className="flex gap-3 whitespace-pre-wrap">
          <span className="shrink-0 text-faint tabular-nums select-none">{fmtTime(r.ts)}</span>
          <span className={r.stream === 'stderr' ? 'text-errfg' : 'text-codefg'}>{r.line}</span>
        </div>
      ))}
    </div>
  );
}
