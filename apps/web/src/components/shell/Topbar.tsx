import type { Me } from '@/api';
import { Icon } from '@/components/ui';
import type { ConnectionStatus } from '@/hooks/useConnectionStatus';
import type { Theme } from '@/lib/theme';

export interface TopbarProps {
  me?: Me;
  connection: ConnectionStatus;
  theme: Theme;
  onToggleTheme: () => void;
  onOpenPalette: () => void;
  onSignIn?: () => void;
  onSignOut?: () => void;
}

/** The persistent top bar: search/command trigger, live status, theme, identity. */
export function Topbar({
  me,
  connection,
  theme,
  onToggleTheme,
  onOpenPalette,
  onSignIn,
  onSignOut,
}: TopbarProps) {
  const signedIn = Boolean(me?.subject);
  const identityOn = me?.identityEnabled;
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
      <button
        type="button"
        onClick={onOpenPalette}
        className="flex h-9 flex-1 items-center gap-2 rounded-lg border border-line bg-app px-3 text-sm text-faint transition-colors hover:border-line2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none sm:max-w-sm"
      >
        <Icon name="magnifying-glass" size={16} />
        <span className="flex-1 text-left">Search services, go to…</span>
        <kbd className="rounded border border-line2 px-1.5 py-0.5 font-mono text-[10px] text-muted">
          ⌘K
        </kbd>
      </button>

      <div className="flex-1" />

      <span
        className="flex items-center gap-1.5 text-xs text-muted"
        title={`Last update ${connection.since}`}
      >
        <span
          aria-hidden
          className={`h-2 w-2 rounded-full ${connection.stale ? 'bg-danger' : 'bg-ok'}`}
        />
        <span className="hidden sm:inline">{connection.stale ? 'Stale' : 'Live'}</span>
      </span>

      <button
        type="button"
        onClick={onToggleTheme}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-row hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
      >
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
      </button>

      {identityOn ? (
        signedIn ? (
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-fg sm:inline">{me?.name ?? me?.subject}</span>
            {onSignOut ? (
              <button
                type="button"
                onClick={onSignOut}
                aria-label="Sign out"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-row hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                <Icon name="sign-out" size={18} />
              </button>
            ) : null}
          </div>
        ) : onSignIn ? (
          <button
            type="button"
            onClick={onSignIn}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-sm text-fg transition-colors hover:border-line2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            <Icon name="sign-in" size={16} /> Sign in
          </button>
        ) : null
      ) : null}
    </header>
  );
}
