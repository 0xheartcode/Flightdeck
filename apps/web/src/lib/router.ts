import { useCallback, useEffect, useState } from 'react';

/**
 * A tiny hash router. The app has a small, fixed set of destinations, so a hash
 * route (e.g. #/service/web) gives back/forward and deep links without pulling
 * in a routing library. Routes are parsed into a discriminated shape.
 */
export type Route =
  | { name: 'overview' }
  | { name: 'deploys' }
  | { name: 'activity' }
  | { name: 'transmitter'; tab?: string }
  | { name: 'hosts' }
  | { name: 'settings'; tab?: string }
  | { name: 'project'; repo: string }
  | { name: 'service'; id: string };

export const NAV_NAMES = [
  'overview',
  'deploys',
  'activity',
  'transmitter',
  'hosts',
  'settings',
] as const;

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/^\/+/, '');
  const [head, ...rest] = path.split('/');
  switch (head) {
    case 'deploys':
      return { name: 'deploys' };
    case 'activity':
      return { name: 'activity' };
    case 'transmitter':
      return { name: 'transmitter', tab: rest[0] };
    case 'hosts':
      return { name: 'hosts' };
    case 'settings':
      return { name: 'settings', tab: rest[0] };
    case 'project':
      return rest[0]
        ? { name: 'project', repo: decodeURIComponent(rest.join('/')) }
        : { name: 'overview' };
    case 'service':
      return rest[0] ? { name: 'service', id: decodeURIComponent(rest[0]) } : { name: 'overview' };
    default:
      return { name: 'overview' };
  }
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case 'overview':
      return '#/overview';
    case 'project':
      return `#/project/${encodeURIComponent(route.repo)}`;
    case 'service':
      return `#/service/${encodeURIComponent(route.id)}`;
    case 'transmitter':
      return route.tab ? `#/transmitter/${route.tab}` : '#/transmitter';
    case 'settings':
      return route.tab ? `#/settings/${route.tab}` : '#/settings';
    default:
      return `#/${route.name}`;
  }
}

export function navigate(route: Route): void {
  window.location.hash = hrefFor(route);
}

/** Subscribe to the current route, re-rendering on hash changes. */
export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = useCallback((r: Route) => navigate(r), []);
  return [route, go];
}
