import { describe, expect, it } from 'vitest';
import { hrefFor, parseHash, type Route } from './router';

describe('parseHash', () => {
  it('defaults to overview for empty or unknown hashes', () => {
    expect(parseHash('')).toEqual({ name: 'overview' });
    expect(parseHash('#/')).toEqual({ name: 'overview' });
    expect(parseHash('#/nope')).toEqual({ name: 'overview' });
  });

  it('parses the top-level destinations', () => {
    expect(parseHash('#/deploys')).toEqual({ name: 'deploys' });
    expect(parseHash('#/activity')).toEqual({ name: 'activity' });
    expect(parseHash('#/hosts')).toEqual({ name: 'hosts' });
  });

  it('parses nested tabs and ids, decoding components', () => {
    expect(parseHash('#/transmitter/channels')).toEqual({ name: 'transmitter', tab: 'channels' });
    expect(parseHash('#/settings/server')).toEqual({ name: 'settings', tab: 'server' });
    expect(parseHash('#/service/web-1')).toEqual({ name: 'service', id: 'web-1' });
    expect(parseHash('#/project/acme%2Fweb')).toEqual({ name: 'project', repo: 'acme/web' });
  });

  it('falls back to overview when a required segment is missing', () => {
    expect(parseHash('#/service')).toEqual({ name: 'overview' });
    expect(parseHash('#/project')).toEqual({ name: 'overview' });
  });
});

describe('hrefFor', () => {
  it('round-trips with parseHash', () => {
    const routes: Route[] = [
      { name: 'overview' },
      { name: 'deploys' },
      { name: 'transmitter', tab: 'routes' },
      { name: 'service', id: 'api/worker' },
      { name: 'project', repo: 'acme/web' },
    ];
    for (const r of routes) {
      expect(parseHash(hrefFor(r))).toEqual(r);
    }
  });

  it('encodes slashes in ids and repos', () => {
    expect(hrefFor({ name: 'project', repo: 'acme/web' })).toBe('#/project/acme%2Fweb');
    expect(hrefFor({ name: 'service', id: 'a/b' })).toBe('#/service/a%2Fb');
  });
});
