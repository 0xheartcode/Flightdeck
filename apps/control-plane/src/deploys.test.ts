import { describe, expect, it } from 'vitest';
import type { DeployRecord } from '@flightdeck/protocol';
import { DeployStore } from './deploys.js';

function deploy(overrides: Partial<DeployRecord> = {}): DeployRecord {
  return {
    id: 'd1',
    repo: 'acme/api',
    sha: 'abc123',
    status: 'success',
    startedAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('DeployStore', () => {
  it('records and lists deploys newest first', () => {
    const store = new DeployStore();
    store.record(deploy({ id: 'd1', updatedAt: 1 }));
    store.record(deploy({ id: 'd2', updatedAt: 2 }));
    expect(store.list().map((d) => d.id)).toEqual(['d2', 'd1']);
  });

  it('upserts by id, updating status and time', () => {
    const store = new DeployStore();
    store.record(deploy({ id: 'd1', status: 'in_progress', updatedAt: 1 }));
    store.record(deploy({ id: 'd1', status: 'success', updatedAt: 2 }));
    const list = store.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.status).toBe('success');
  });

  it('returns the latest deploy for a repo', () => {
    const store = new DeployStore();
    store.record(deploy({ id: 'd1', repo: 'acme/api', updatedAt: 1 }));
    store.record(deploy({ id: 'd2', repo: 'acme/api', updatedAt: 3 }));
    store.record(deploy({ id: 'd3', repo: 'other/x', updatedAt: 5 }));
    expect(store.latestForRepo('acme/api')?.id).toBe('d2');
    expect(store.latestForRepo('nope')).toBeUndefined();
  });

  it('filters list by repo', () => {
    const store = new DeployStore();
    store.record(deploy({ id: 'a', repo: 'acme/api' }));
    store.record(deploy({ id: 'b', repo: 'other/x' }));
    expect(store.list('acme/api').map((d) => d.id)).toEqual(['a']);
  });
});
