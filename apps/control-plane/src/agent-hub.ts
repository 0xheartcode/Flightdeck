import { WebSocket } from 'ws';
import { parseAgentMessage, type ServerCommand } from '@flightdeck/protocol';
import type { Context } from './context.js';
import { logger } from './logger.js';

/**
 * Wire a single authenticated agent socket into the store. The upgrade
 * handler has already verified the bearer token before this runs.
 */
export function handleAgentConnection(ws: WebSocket, ctx: Context, agentName: string): void {
  const { store, commands, metrics, loki } = ctx;
  // Services announced over this connection. Used to remove them when the
  // agent disconnects (a dead host must not linger as a false "running"), and
  // to stop one connection from reporting for services it did not announce.
  const owned = new Set<string>();
  const log = logger.child({ component: 'agent', agent: agentName });
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
      log.warn({ err: (err as Error).message }, 'dropped invalid message');
      return;
    }

    switch (msg.type) {
      case 'hello':
        connHost = msg.hostname;
        log.info({ agentId: msg.agentId, host: msg.hostname }, 'agent connected');
        break;
      case 'service': {
        // A connection may only announce services for its own host.
        if (connHost !== undefined && msg.service.host !== connHost) {
          log.warn({ claimedHost: msg.service.host }, 'rejected service for a different host');
          break;
        }
        // Split env off the registry record: it holds secret values and must
        // never be broadcast. It is stored separately and served masked.
        const { env, ...service } = msg.service;
        owned.add(service.id);
        store.upsertService(service);
        store.setEnv(service.id, env);
        commands.registerService(service.id, sendCommand);
        break;
      }
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
        metrics.incLogLines();
        loki?.push(msg.log);
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
    log.info('agent disconnected');
    for (const id of owned) {
      store.removeService(id);
      commands.unregisterService(id, sendCommand);
    }
    owned.clear();
  });
}
