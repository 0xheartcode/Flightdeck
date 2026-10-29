import { WebSocket } from 'ws';
import { parseAgentMessage, type ServerCommand } from '@flightdeck/protocol';
import type { CommandBus } from './commands.js';
import type { Store } from './store.js';

/**
 * Wire a single authenticated agent socket into the store. The upgrade
 * handler in index.ts has already verified the bearer token before this runs.
 */
export function handleAgentConnection(
  ws: WebSocket,
  store: Store,
  commands: CommandBus,
  agentName: string,
): void {
  // Services announced over this connection. Used to remove them when the
  // agent disconnects (a dead host must not linger as a false "running"), and
  // to stop one connection from reporting for services it did not announce.
  const owned = new Set<string>();
  let label = agentName;
  let connHost: string | undefined;

  // How to send a command down to this agent (used by the CommandBus).
  const sendCommand = (command: ServerCommand): void => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(command));
    }
  };

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
        connHost = msg.hostname;
        label = `${agentName} (${msg.agentId} @ ${msg.hostname})`;
        console.log(`[agent] connected: ${label}`);
        break;
      case 'service':
        // A connection may only announce services for its own host.
        if (connHost !== undefined && msg.service.host !== connHost) {
          console.warn(`[agent] ${label} tried to announce service for host ${msg.service.host}`);
          break;
        }
        owned.add(msg.service.id);
        store.upsertService(msg.service);
        commands.registerService(msg.service.id, sendCommand);
        break;
      case 'service_gone':
        if (!owned.has(msg.serviceId)) break;
        owned.delete(msg.serviceId);
        store.removeService(msg.serviceId);
        commands.unregisterService(msg.serviceId, sendCommand);
        break;
      case 'status':
        if (!owned.has(msg.serviceId)) break;
        store.setStatus(msg.serviceId, msg.state, msg.exitCode, msg.ts);
        break;
      case 'log':
        if (!owned.has(msg.log.serviceId)) break;
        store.appendLog(msg.log);
        break;
      case 'stats':
        if (!owned.has(msg.stats.serviceId)) break;
        store.setStats(msg.stats);
        break;
      case 'command_result':
        commands.resolve(msg.id, msg.ok, msg.error);
        break;
    }
  });

  ws.on('close', () => {
    console.log(`[agent] disconnected: ${label}`);
    for (const id of owned) {
      store.removeService(id);
      commands.unregisterService(id, sendCommand);
    }
    owned.clear();
  });
}
