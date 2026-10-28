import type { WebSocket } from 'ws';
import { parseAgentMessage } from '@flightdeck/protocol';
import type { Store } from './store.js';

/**
 * Wire a single authenticated agent socket into the store. The upgrade
 * handler in index.ts has already verified the bearer token before this runs.
 */
export function handleAgentConnection(ws: WebSocket, store: Store): void {
  // Services announced over this connection, so we can remove them when the
  // agent disconnects (a dead host must not linger as a false "running").
  const owned = new Set<string>();
  let label = 'unknown';

  ws.on('message', (data: unknown) => {
    let msg;
    try {
      msg = parseAgentMessage(String(data));
    } catch (err) {
      console.warn('[agent] dropped invalid message:', (err as Error).message);
      return;
    }

    switch (msg.type) {
      case 'hello':
        label = `${msg.agentId} @ ${msg.hostname}`;
        console.log(`[agent] connected: ${label}`);
        break;
      case 'service':
        owned.add(msg.service.id);
        store.upsertService(msg.service);
        break;
      case 'service_gone':
        owned.delete(msg.serviceId);
        store.removeService(msg.serviceId);
        break;
      case 'status':
        store.setStatus(msg.serviceId, msg.state, msg.exitCode, msg.ts);
        break;
      case 'log':
        store.appendLog(msg.log);
        break;
      case 'stats':
        store.setStats(msg.stats);
        break;
    }
  });

  ws.on('close', () => {
    console.log(`[agent] disconnected: ${label}`);
    for (const id of owned) {
      store.removeService(id);
    }
    owned.clear();
  });
}
