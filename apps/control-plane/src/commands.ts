import { randomUUID } from 'node:crypto';
import {
  PROTOCOL_VERSION,
  type CommandAction,
  type EnvVar,
  type ServerCommand,
} from '@flightdeck/protocol';
import { nullBus, type Bus, type BusMessage } from './bus.js';

export interface CommandOutcome {
  ok: boolean;
  error?: string;
}

/** Sends a command down to the agent that owns a service. */
type CommandSender = (command: ServerCommand) => void;

/**
 * Routes operator actions to the agent that owns a service and resolves when
 * that agent reports the result. The owning agent may be connected to a
 * different control-plane instance: if no local agent owns the service and a
 * bus is configured, the command is published to the bus for the owning
 * instance to run, and the result comes back over the bus.
 */
export class CommandBus {
  private readonly senders = new Map<string, CommandSender>();
  // Local-origin commands awaiting a result (resolve the dispatch promise).
  private readonly pending = new Map<string, (outcome: CommandOutcome) => void>();
  // Commands we are running on behalf of another instance (result goes to the bus).
  private readonly remoteOrigin = new Map<string, ReturnType<typeof setTimeout>>();
  private bus: Bus = nullBus;

  constructor(private readonly timeoutMs: number = 20_000) {}

  /** Wire the inter-instance bus (for cross-instance command routing). */
  setBus(bus: Bus): void {
    this.bus = bus;
  }

  registerService(serviceId: string, send: CommandSender): void {
    this.senders.set(serviceId, send);
  }

  /** Remove a service's sender, but only if it is still the given one. */
  unregisterService(serviceId: string, send: CommandSender): void {
    if (this.senders.get(serviceId) === send) {
      this.senders.delete(serviceId);
    }
  }

  private toAgent(
    send: CommandSender,
    id: string,
    action: CommandAction,
    serviceId: string,
    containerId: string,
    env?: EnvVar[],
  ): void {
    send({ v: PROTOCOL_VERSION, type: 'command', id, action, serviceId, containerId, env });
  }

  dispatch(
    serviceId: string,
    action: CommandAction,
    containerId: string,
    env?: EnvVar[],
  ): Promise<CommandOutcome> {
    const send = this.senders.get(serviceId);
    if (!send && !this.bus.distributed) {
      return Promise.resolve({ ok: false, error: 'no connected agent for this service' });
    }
    const id = randomUUID();
    return new Promise<CommandOutcome>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          resolve({ ok: false, error: 'agent did not respond in time' });
        }
      }, this.timeoutMs);
      this.pending.set(id, (outcome) => {
        clearTimeout(timer);
        resolve(outcome);
      });
      if (send) {
        this.toAgent(send, id, action, serviceId, containerId, env);
      } else {
        // A remote instance may own the service; let it run the command.
        this.bus.publish({ kind: 'command', id, serviceId, action, containerId, env });
      }
    });
  }

  /** A command from another instance: run it if we own the service. */
  handleBusCommand(msg: Extract<BusMessage, { kind: 'command' }>): void {
    const send = this.senders.get(msg.serviceId);
    if (!send) return; // not ours
    // Clean up if the agent never replies (the originator times out anyway).
    const timer = setTimeout(() => this.remoteOrigin.delete(msg.id), this.timeoutMs + 5_000);
    this.remoteOrigin.set(msg.id, timer);
    this.toAgent(send, msg.id, msg.action, msg.serviceId, msg.containerId, msg.env);
  }

  /** Called when an agent returns a command result. */
  resolve(id: string, ok: boolean, error?: string): void {
    const settle = this.pending.get(id);
    if (settle) {
      this.pending.delete(id);
      settle({ ok, error });
      return;
    }
    // Not local-origin: we ran it for another instance, so return the result over the bus.
    const timer = this.remoteOrigin.get(id);
    if (timer) {
      clearTimeout(timer);
      this.remoteOrigin.delete(id);
      this.bus.publish({ kind: 'command_result', id, ok, error });
    }
  }
}
