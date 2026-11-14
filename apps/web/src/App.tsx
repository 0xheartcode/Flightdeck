import { useQuery } from '@tanstack/react-query';
import type { ServiceInfo } from '@flightdeck/protocol';
import { ApiError, type Me } from '@/api';
import { Icon } from '@/components/ui';
import { Shell } from '@/components/shell/Shell';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useMe } from '@/hooks/useMe';
import { usePermissions } from '@/hooks/usePermissions';
import { useServices } from '@/hooks/useServices';
import { byHost, hostOnline, needsAttention } from '@/lib/services';
import { useRoute, type Route } from '@/lib/router';
import { getTransmitter } from '@/lib/transmitter/client';
import { Activity } from '@/screens/Activity';
import { Deploys } from '@/screens/Deploys';
import { Hosts } from '@/screens/Hosts';
import { Overview } from '@/screens/Overview';
import { Project } from '@/screens/Project';
import { ServiceDetail } from '@/screens/ServiceDetail';
import { Settings } from '@/screens/Settings';
import { SignIn } from '@/screens/SignIn';
import { Transmitter } from '@/screens/Transmitter';

const isUnauthorized = (err: unknown): boolean => err instanceof ApiError && err.status === 401;

export function App() {
  const meQ = useMe();
  const servicesQ = useServices();
  const perms = usePermissions();
  const [route, go] = useRoute();

  const services = servicesQ.data ?? [];
  const connection = useConnectionStatus(servicesQ.dataUpdatedAt, servicesQ.isError);

  // Unread signals drive the Transmitter nav badge. The mock is safe to poll.
  const unreadQ = useQuery({
    queryKey: ['tx', 'signals'],
    queryFn: () => getTransmitter().listSignals(),
    select: (sigs) => sigs.filter((s) => !s.read).length,
  });

  // While identity is unknown, avoid flashing the shell before the 401 resolves.
  if (meQ.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app text-faint">
        <Icon name="circle-notch" size={22} className="motion-safe:animate-spin" label="Loading" />
      </div>
    );
  }

  const unauthorized = isUnauthorized(meQ.error) || isUnauthorized(servicesQ.error);
  const identityEnabled = meQ.data?.identityEnabled ?? unauthorized;
  const authenticated = identityEnabled ? Boolean(meQ.data?.subject) : true;

  if (identityEnabled && !authenticated) {
    return <SignIn loginFlow={meQ.data?.loginFlow ?? false} />;
  }

  const attention = services.filter((s) => needsAttention(s.state)).length;
  const hosts = byHost(services);
  const onlineHosts = hosts.filter((h) => hostOnline(h.services)).length;
  const badges: Partial<Record<string, string>> = {
    overview: attention > 0 ? String(attention) : undefined,
    transmitter: unreadQ.data ? String(unreadQ.data) : undefined,
    hosts: hosts.length ? `${onlineHosts}/${hosts.length}` : undefined,
  };

  const onNavigate = (r: Route) => go(r);

  return (
    <Shell
      route={route}
      me={meQ.data}
      services={services}
      connection={connection}
      actionsEnabled={perms.actionsEnabled}
      badges={badges}
      onNavigate={onNavigate}
    >
      <RouteView
        route={route}
        onNavigate={onNavigate}
        services={services}
        logSearch={Boolean(meQ.data?.logSearch)}
        me={meQ.data}
        loading={servicesQ.isLoading}
        error={servicesQ.isError}
        onConnectAgent={() => go({ name: 'overview' })}
      />
    </Shell>
  );
}

interface RouteViewProps {
  route: Route;
  onNavigate: (r: Route) => void;
  services: ServiceInfo[];
  logSearch: boolean;
  me: Me | undefined;
  loading: boolean;
  error: boolean;
  onConnectAgent: () => void;
}

function RouteView({
  route,
  onNavigate,
  services,
  logSearch,
  me,
  loading,
  error,
  onConnectAgent,
}: RouteViewProps) {
  switch (route.name) {
    case 'overview':
      return (
        <Overview
          services={services}
          loading={loading}
          error={error}
          onNavigate={onNavigate}
          onConnectAgent={onConnectAgent}
        />
      );
    case 'deploys':
      return <Deploys onNavigate={onNavigate} />;
    case 'activity':
      return <Activity onNavigate={onNavigate} />;
    case 'transmitter':
      return <Transmitter />;
    case 'hosts':
      return <Hosts services={services} loading={loading} error={error} onNavigate={onNavigate} />;
    case 'settings':
      return <Settings me={me} tab={route.tab} onNavigate={onNavigate} />;
    case 'project':
      return <Project repo={route.repo} services={services} onNavigate={onNavigate} />;
    case 'service':
      return (
        <ServiceDetail serviceId={route.id} onNavigate={onNavigate} logSearchEnabled={logSearch} />
      );
    default:
      return null;
  }
}
