import { Icon } from '@/components/ui';

/**
 * Server-wide "actions are disabled" banner. Shown when FD_ENABLE_ACTIONS is off
 * so operators understand why every restart/redeploy/set-env control is
 * disabled, rather than finding controls that silently do nothing.
 */
export function ActionsDisabledBanner() {
  return (
    <div
      role="status"
      className="flex items-center gap-2.5 border-b border-line bg-[var(--abg)] px-4 py-2 text-sm text-warn"
    >
      <Icon name="lock-simple" size={16} className="shrink-0" />
      <span>
        <strong className="font-semibold">Actions are disabled on this server.</strong> Restart,
        redeploy and environment changes are turned off (FD_ENABLE_ACTIONS). Viewing is unaffected.
      </span>
    </div>
  );
}

/**
 * Stream-stale indicator. The registry auto-retries on its own (that is the
 * reconnect); this tells the user the data on screen may be behind and how long
 * it has been since the last successful update.
 */
export function StreamStaleBanner({ since }: { since: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2.5 border-b border-line bg-[var(--rbg)] px-4 py-2 text-sm text-errfg"
    >
      <Icon name="warning" size={16} className="shrink-0" />
      <span>
        <strong className="font-semibold">Live data is stale.</strong> Last update {since}. Trying
        to reconnect…
      </span>
    </div>
  );
}
