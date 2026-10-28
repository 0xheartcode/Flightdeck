import type { WebSocket } from 'ws';
import { parseAgentMessage } from '@flightdeck/protocol';
import type { Store } from './store.js';

/**
 * Wire a single authenticated agent socket into the store. The upgrade
 * handler in index.ts has already verified the bearer token before this runs.
 */
export function handleAgentConnection(ws: WebSocket, store: Store): void {
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
        console.log(`[agent] connected: ${msg.agentId} @ ${msg.hostname}`);
        break;
      case 'service':
        store.upsertService(msg.service);
        break;
      case 'service_gone':
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
    console.log('[agent] disconnected');
  });
}
