import { describe, expect, it } from 'vitest';
import type { ServerCommand } from '@flightdeck/protocol';
import { CommandBus } from './commands.js';

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
