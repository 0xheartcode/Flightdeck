import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { ServiceInfo } from '@flightdeck/protocol';
import { clearToken, loginUrl, logoutUrl, type Me } from '@/api';
import type { ConnectionStatus } from '@/hooks/useConnectionStatus';
import { useTheme } from '@/hooks/useTheme';
import type { Route } from '@/lib/router';
import { ActionsDisabledBanner, StreamStaleBanner } from './Banners';
import { CommandPalette } from './CommandPalette';
import { ConnectAgentDrawer } from './ConnectAgentDrawer';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export interface ShellProps {
  route: Route;
  me?: Me;
  services: ServiceInfo[];
  connection: ConnectionStatus;
  actionsEnabled: boolean;
  badges?: Partial<Record<string, string>>;
  onNavigate: (route: Route) => void;
  children: ReactNode;
}

export function Shell({
  route,
  me,
  services,
  connection,
  actionsEnabled,
  badges,
  onNavigate,
  children,
}: ShellProps) {
  const { theme, toggle } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  // ⌘K / Ctrl-K opens the palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const signedIn = Boolean(me?.subject);
  const canSignIn = me?.identityEnabled && me?.loginFlow && !signedIn;

  return (
    <div className="flex h-screen overflow-hidden bg-app text-fg">
      <Sidebar active={route.name} badges={badges} onConnectAgent={() => setConnectOpen(true)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          me={me}
          connection={connection}
          theme={theme}
          onToggleTheme={toggle}
          onOpenPalette={() => setPaletteOpen(true)}
          onSignIn={canSignIn ? () => (window.location.href = loginUrl()) : undefined}
          onSignOut={
            signedIn
              ? () => {
                  clearToken();
                  window.location.href = logoutUrl();
                }
              : undefined
          }
        />
        {!actionsEnabled ? <ActionsDisabledBanner /> : null}
        {connection.stale ? <StreamStaleBanner since={connection.since} /> : null}
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        services={services}
        onNavigate={onNavigate}
      />
      <ConnectAgentDrawer open={connectOpen} onClose={() => setConnectOpen(false)} />
    </div>
  );
}
