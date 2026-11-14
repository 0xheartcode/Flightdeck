import type { ServiceInfo, ServiceState } from '@flightdeck/protocol';
import { describe, expect, it } from 'vitest';
import { byHost, byRepo, hostOnline, needsAttention } from './services';

const svc = (over: Partial<ServiceInfo>): ServiceInfo => ({
  id: over.id ?? 'id',
  name: over.name ?? 'svc',
  image: 'img',
  containerId: 'c',
  state: over.state ?? 'running',
  host: over.host ?? 'h1',
  createdAt: 0,
  repo: over.repo,
  environment: over.environment,
});

describe('needsAttention', () => {
  it('flags exited/dead/restarting/unknown and not running/paused', () => {
    const attention: ServiceState[] = ['exited', 'dead', 'restarting', 'unknown'];
    const calm: ServiceState[] = ['running', 'paused', 'created', 'removing'];
    for (const s of attention) expect(needsAttention(s)).toBe(true);
    for (const s of calm) expect(needsAttention(s)).toBe(false);
  });
});

describe('byHost', () => {
  it('groups by host, sorted by host name', () => {
    const groups = byHost([
      svc({ id: 'a', host: 'z' }),
      svc({ id: 'b', host: 'a' }),
      svc({ id: 'c', host: 'a' }),
    ]);
    expect(groups.map((g) => g.host)).toEqual(['a', 'z']);
    expect(groups[0]?.services).toHaveLength(2);
  });
});

describe('byRepo', () => {
  it('ignores services without a repo and groups the rest', () => {
    const groups = byRepo([
      svc({ id: 'a', repo: 'acme/web' }),
      svc({ id: 'b' }),
      svc({ id: 'c', repo: 'acme/web' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.repo).toBe('acme/web');
    expect(groups[0]?.services).toHaveLength(2);
  });
});

describe('hostOnline', () => {
  it('is online when any service is not dead/exited', () => {
    expect(hostOnline([svc({ state: 'exited' }), svc({ state: 'running' })])).toBe(true);
    expect(hostOnline([svc({ state: 'exited' }), svc({ state: 'dead' })])).toBe(false);
  });
});
