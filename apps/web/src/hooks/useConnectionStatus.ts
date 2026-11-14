import { useEffect, useState } from 'react';

const STALE_AFTER_MS = 15_000; // three missed 5s registry polls

export interface ConnectionStatus {
  /** True when the registry has not refreshed within the stale window, or errored. */
  stale: boolean;
  /** Milliseconds since the last successful update. */
  sinceMs: number;
  /** Human label, e.g. "just now", "12s ago", "3m ago". */
  since: string;
}

function fmtSince(ms: number): string {
  if (ms < 2000) return 'just now';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

/**
 * Derive a live "stream freshness" status from the registry query. The services
 * query polls every 5s and auto-retries on failure (that is the reconnect), so
 * the time since its last success is a faithful staleness signal: if the control
 * plane is down, the timestamp stops advancing and we cross the stale threshold.
 * A 1s ticker keeps the "since" label moving between renders.
 */
export function useConnectionStatus(dataUpdatedAt: number, isError: boolean): ConnectionStatus {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const sinceMs = dataUpdatedAt > 0 ? now - dataUpdatedAt : Number.POSITIVE_INFINITY;
  const stale = isError || sinceMs > STALE_AFTER_MS;
  return {
    stale,
    sinceMs,
    since: Number.isFinite(sinceMs) ? fmtSince(sinceMs) : 'never',
  };
}
