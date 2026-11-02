import { describe, expect, it } from 'vitest';
import type { LogLine, ServerMessage, ServiceInfo } from '@flightdeck/protocol';
import { Store } from './store.js';

function service(id: string): ServiceInfo {
  return {
    id,
    name: id,
    image: 'img',
    containerId: 'c-' + id,
    state: 'running',
    host: 'test-host',
    createdAt: 0,
  };
}

function log(serviceId: string, line: string): LogLine {
  return { serviceId, stream: 'stdout', ts: 0, line };
}

describe('Store', () => {
  it('lists services sorted by id', () => {
    const store = new Store(10);
    store.upsertService(service('b'));
    store.upsertService(service('a'));
    expect(store.listServices().map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('bounds the log ring buffer to bufferSize', () => {
    const store = new Store(3);
    store.upsertService(service('api'));
    for (let i = 0; i < 10; i++) {
      store.appendLog(log('api', `line ${i}`));
    }
    const lines = store.recentLogs('api');
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.line)).toEqual(['line 7', 'line 8', 'line 9']);
  });

  it('delivers live logs to a subscriber and stops after unsubscribe', () => {
    const store = new Store(10);
    store.upsertService(service('api'));
    const received: ServerMessage[] = [];
    const unsub = store.subscribe('api', (m) => received.push(m));

    store.appendLog(log('api', 'hello'));
    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe('log');

    unsub();
    store.appendLog(log('api', 'ignored'));
    expect(received).toHaveLength(1);
  });

  it('notifies services listeners on upsert and removal', () => {
    const store = new Store(10);
    let latest: ServiceInfo[] = [];
    store.subscribeServices((s) => {
      latest = s;
    });
    store.upsertService(service('api'));
    expect(latest.map((s) => s.id)).toEqual(['api']);
    store.removeService('api');
    expect(latest).toEqual([]);
  });

  it('updates service state on status change', () => {
    const store = new Store(10);
    store.upsertService(service('api'));
    store.setStatus('api', 'exited', 137, 1);
    expect(store.getService('api')?.state).toBe('exited');
  });

  it('caps the service registry at maxServices', () => {
    const store = new Store(10, 2);
    store.upsertService(service('a'));
    store.upsertService(service('b'));
    store.upsertService(service('c')); // dropped: over the cap
    expect(store.listServices().map((s) => s.id)).toEqual(['a', 'b']);
    // An update to an existing service still works at the cap.
    store.setStatus('a', 'exited', 0, 1);
    expect(store.getService('a')?.state).toBe('exited');
  });

  it('drops logs for unknown (never-announced) services', () => {
    const store = new Store(10);
    store.appendLog(log('ghost', 'should be ignored'));
    expect(store.recentLogs('ghost')).toEqual([]);
  });

  it('stores and clears env separately, and never exposes it on the registry', () => {
    const store = new Store(10);
    store.upsertService(service('api'));
    store.setEnv('api', [{ key: 'A', value: '1' }]);
    expect(store.getEnv('api')).toEqual([{ key: 'A', value: '1' }]);
    // Env must not ride the broadcast registry record.
    expect(store.getService('api')).not.toHaveProperty('env');
    // An empty list clears it.
    store.setEnv('api', []);
    expect(store.getEnv('api')).toBeUndefined();
  });

  it('drops env when a service is removed', () => {
    const store = new Store(10);
    store.upsertService(service('api'));
    store.setEnv('api', [{ key: 'A', value: '1' }]);
    store.removeService('api');
    expect(store.getEnv('api')).toBeUndefined();
  });

  it('fans out in isolation at scale and stops cleanly on unsubscribe', () => {
    const store = new Store(5000);
    const N = 100;
    const perService = 50;
    const counts = new Map<string, number>();
    const unsubs: Array<() => void> = [];
    for (let i = 0; i < N; i++) {
      const id = `svc-${i}`;
      store.upsertService(service(id));
      counts.set(id, 0);
      unsubs.push(
        store.subscribe(id, (m) => {
          if (m.type === 'log') counts.set(id, (counts.get(id) ?? 0) + 1);
        }),
      );
    }

    for (let i = 0; i < N; i++) {
      for (let j = 0; j < perService; j++) {
        store.appendLog(log(`svc-${i}`, `line-${j}`));
      }
    }
    // Each subscriber received exactly its own service's logs, no cross-talk.
    for (let i = 0; i < N; i++) {
      expect(counts.get(`svc-${i}`)).toBe(perService);
    }

    // After unsubscribing every listener, further logs reach nobody.
    for (const unsub of unsubs) unsub();
    for (let i = 0; i < N; i++) {
      store.appendLog(log(`svc-${i}`, 'after-unsub'));
    }
    for (let i = 0; i < N; i++) {
      expect(counts.get(`svc-${i}`)).toBe(perService);
    }
  });

  it('delivers one service event to all of its subscribers', () => {
    const store = new Store(10);
    store.upsertService(service('api'));
    let a = 0;
    let b = 0;
    store.subscribe('api', () => (a += 1));
    store.subscribe('api', () => (b += 1));
    store.appendLog(log('api', 'hello'));
    expect(a).toBe(1);
    expect(b).toBe(1);
  });
});
