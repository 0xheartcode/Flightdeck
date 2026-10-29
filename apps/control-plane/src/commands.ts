import { randomUUID } from 'node:crypto';
import { PROTOCOL_VERSION, type ActionKind, type ServerCommand } from '@flightdeck/protocol';

export interface CommandOutcome {
  ok: boolean;
  error?: string;
}

/** Sends a command down to the agent that owns a service. */
type CommandSender = (command: ServerCommand) => void;

/**
 * Routes operator actions (restart, ...) to the agent that owns a service and
 * resolves when that agent reports the result. Each service has at most one
 * sender (its current agent connection); results are matched by command id.
 */
export class CommandBus {
  private readonly senders = new Map<string, CommandSender>();
  private readonly pending = new Map<string, (outcome: CommandOutcome) => void>();

  constructor(private readonly timeoutMs: number = 20_000) {}

  registerService(serviceId: string, send: CommandSender): void {
    this.senders.set(serviceId, send);
  }

  /** Remove a service's sender, but only if it is still the given one. */
  unregisterService(serviceId: string, send: CommandSender): void {
    if (this.senders.get(serviceId) === send) {
      this.senders.delete(serviceId);
    }
  }

  dispatch(serviceId: string, action: ActionKind, containerId: string): Promise<CommandOutcome> {
    const send = this.senders.get(serviceId);
    if (!send) {
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
      send({ v: PROTOCOL_VERSION, type: 'command', id, action, serviceId, containerId });
    });
  }

  /** Called when an agent returns a command result. */
  resolve(id: string, ok: boolean, error?: string): void {
    const settle = this.pending.get(id);
    if (settle) {
      this.pending.delete(id);
      settle({ ok, error });
    }
  }
}
