/** Format an epoch-millisecond timestamp as local HH:MM:SS. */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Join truthy class names (tiny clsx). */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Format a byte count as a human-readable string (e.g. "12.4 MB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

/** Compact relative time from an epoch-millisecond timestamp (e.g. "3m ago"). */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const ms = now - ts;
  if (!Number.isFinite(ms)) return '';
  if (ms < 0) return 'in the future';
  if (ms < 10_000) return 'just now';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

/** First 7 characters of a commit SHA, for compact display. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
