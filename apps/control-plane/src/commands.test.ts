import { describe, expect, it } from 'vitest';
import type { ServerCommand } from '@flightdeck/protocol';
import type { Bus, BusMessage } from './bus.js';
import { CommandBus } from './commands.js';

/** A bus that records what is published and lets a test inject incoming messages. */
class FakeBus implements Bus {
  readonly distributed = true;
  published: BusMessage[] = [];
  publish(msg: BusMessage): void {
    this.published.push(msg);
  }
  onMessage(): void {}
  start(): void {}
  close(): Promise<void> {
    return Promise.resolve();
  }
}

describe('CommandBus', () => {
  it('fails fast when no agent owns the service', async () => {
    const bus = new CommandBus(1000);
    await expect(bus.dispatch('ghost', 'restart', 'cid')).resolves.toMatchObject({ ok: false });
  });

  it('dispatches to the owning agent and resolves on the agent result', async () => {
    const bus = new CommandBus(1000);
    let sent: ServerCommand | undefined;
    bus.registerService('svc', (cmd) => {
      sent = cmd;
    });

    const pending = bus.dispatch('svc', 'restart', 'cid-1');
    expect(sent).toBeDefined();
    expect(sent).toMatchObject({ type: 'command', action: 'restart', containerId: 'cid-1' });

    bus.resolve(sent!.id, true);
    await expect(pending).resolves.toEqual({ ok: true, error: undefined });
  });

  it('relays an agent error', async () => {
    const bus = new CommandBus(1000);
    let sent: ServerCommand | undefined;
    bus.registerService('svc', (cmd) => {
      sent = cmd;
    });
    const pending = bus.dispatch('svc', 'restart', 'cid');
    bus.resolve(sent!.id, false, 'boom');
    await expect(pending).resolves.toEqual({ ok: false, error: 'boom' });
  });

  it('times out when the agent never responds', async () => {
    const bus = new CommandBus(10);
    bus.registerService('svc', () => {});
    await expect(bus.dispatch('svc', 'restart', 'cid')).resolves.toMatchObject({ ok: false });
  });

  it('publishes to the bus when no local agent owns the service (HA), and resolves on the bus result', async () => {
    const bus = new CommandBus(1000);
    const fake = new FakeBus();
    bus.setBus(fake);

    const pending = bus.dispatch('remote-svc', 'restart', 'cid');
    const published = fake.published.find((m) => m.kind === 'command');
    expect(published).toMatchObject({
      kind: 'command',
      serviceId: 'remote-svc',
      action: 'restart',
    });

    // The owning instance ran it and returns the result over the bus.
    const id = (published as Extract<BusMessage, { kind: 'command' }>).id;
    bus.resolve(id, true);
    await expect(pending).resolves.toEqual({ ok: true, error: undefined });
  });

  it('runs a bus command it owns and returns the result over the bus', async () => {
    const bus = new CommandBus(1000);
    const fake = new FakeBus();
    bus.setBus(fake);
    let sent: ServerCommand | undefined;
    bus.registerService('svc', (cmd) => {
      sent = cmd;
    });

    bus.handleBusCommand({
      kind: 'command',
      id: 'x1',
      serviceId: 'svc',
      action: 'restart',
      containerId: 'cid',
    });
    expect(sent).toMatchObject({ id: 'x1', action: 'restart', containerId: 'cid' });

    // The agent replies; the result goes back over the bus, not to a local promise.
    bus.resolve('x1', false, 'nope');
    expect(fake.published).toContainEqual({
      kind: 'command_result',
      id: 'x1',
      ok: false,
      error: 'nope',
    });
  });

  it('ignores a bus command for a service it does not own', () => {
    const bus = new CommandBus(1000);
    const fake = new FakeBus();
    bus.setBus(fake);
    bus.handleBusCommand({
      kind: 'command',
      id: 'y',
      serviceId: 'other',
      action: 'restart',
      containerId: 'c',
    });
    bus.resolve('y', true); // no local pending, not ours -> nothing published
    expect(fake.published).toHaveLength(0);
  });

  it('unregisters only the matching sender', () => {
    const bus = new CommandBus(1000);
    let viaA = false;
    const a = (): void => {
      viaA = true;
    };
    bus.registerService('svc', a);
    bus.unregisterService('svc', () => {}); // a different sender: must be a no-op
    void bus.dispatch('svc', 'restart', 'cid');
    expect(viaA).toBe(true);
  });
});
