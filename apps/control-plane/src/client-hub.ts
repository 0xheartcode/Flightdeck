import { WebSocket } from 'ws';
import { parseClientMessage, type ActionKind, type ServerMessage } from '@flightdeck/protocol';
import type { CommandBus } from './commands.js';
import type { Config } from './config.js';
import type { Store } from './store.js';

/** Max distinct services one browser socket may subscribe to. */
const MAX_SUBSCRIPTIONS = 50;
/** Drop live frames once the socket's outbound buffer exceeds this (slow consumer). */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

/**
 * Wire a browser socket into the store: push the live service list, on
 * `subscribe` replay the recent log tail then stream new events, and on
 * `action` dispatch an allowlisted command to the owning agent.
 */
export function handleClientConnection(
  ws: WebSocket,
  store: Store,
  commands: CommandBus,
  config: Config,
): void {
  const unsubscribers = new Map<string, () => void>();

  const send = (msg: ServerMessage): void => {
    if (ws.readyState !== WebSocket.OPEN) return;
    // Backpressure: if the client is not draining, drop live frames rather
    // than buffer without bound. The UI recovers from gaps on reconnect.
    if (ws.bufferedAmount > MAX_BUFFERED_BYTES) return;
    ws.send(JSON.stringify(msg));
  };

  send({ type: 'services', services: store.listServices() });
  const unsubServices = store.subscribeServices((services) => {
    send({ type: 'services', services });
  });

  ws.on('message', (data: unknown) => {
    let msg;
    try {
      msg = parseClientMessage(String(data));
    } catch {
      return;
    }

    switch (msg.type) {
      case 'subscribe': {
        if (unsubscribers.has(msg.serviceId)) return;
        if (unsubscribers.size >= MAX_SUBSCRIPTIONS) return;
        send({ type: 'snapshot', serviceId: msg.serviceId, logs: store.recentLogs(msg.serviceId) });
        unsubscribers.set(msg.serviceId, store.subscribe(msg.serviceId, send));
        return;
      }
      case 'unsubscribe': {
        const unsub = unsubscribers.get(msg.serviceId);
        if (unsub) {
          unsub();
          unsubscribers.delete(msg.serviceId);
        }
        return;
      }
      case 'action': {
        void handleAction(msg.serviceId, msg.action);
        return;
      }
    }
  });

  async function handleAction(serviceId: string, action: ActionKind): Promise<void> {
    if (!config.actionsEnabled) {
      send({ type: 'action_result', serviceId, action, ok: false, error: 'actions are disabled' });
      return;
    }
    const service = store.getService(serviceId);
    if (!service) {
      send({ type: 'action_result', serviceId, action, ok: false, error: 'unknown service' });
      return;
    }
    const outcome = await commands.dispatch(serviceId, action, service.containerId);
    send({ type: 'action_result', serviceId, action, ok: outcome.ok, error: outcome.error });
  }

  ws.on('close', () => {
    unsubServices();
    for (const unsub of unsubscribers.values()) {
      unsub();
    }
    unsubscribers.clear();
  });
}
