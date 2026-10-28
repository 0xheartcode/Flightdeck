import { WebSocket } from 'ws';
import { parseClientMessage, type ServerMessage } from '@flightdeck/protocol';
import type { Store } from './store.js';

/** Max distinct services one browser socket may subscribe to. */
const MAX_SUBSCRIPTIONS = 50;
/** Drop live frames once the socket's outbound buffer exceeds this (slow consumer). */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

/**
 * Wire a browser socket into the store: push the live service list, and on
 * `subscribe` replay the recent log tail (snapshot) then stream new events.
 */
export function handleClientConnection(ws: WebSocket, store: Store): void {
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

    if (msg.type === 'subscribe') {
      if (unsubscribers.has(msg.serviceId)) return;
      if (unsubscribers.size >= MAX_SUBSCRIPTIONS) return;
      send({ type: 'snapshot', serviceId: msg.serviceId, logs: store.recentLogs(msg.serviceId) });
      unsubscribers.set(msg.serviceId, store.subscribe(msg.serviceId, send));
    } else {
      const unsub = unsubscribers.get(msg.serviceId);
      if (unsub) {
        unsub();
        unsubscribers.delete(msg.serviceId);
      }
    }
  });

  ws.on('close', () => {
    unsubServices();
    for (const unsub of unsubscribers.values()) {
      unsub();
    }
    unsubscribers.clear();
  });
}
