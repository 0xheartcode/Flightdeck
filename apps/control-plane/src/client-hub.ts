import { WebSocket } from 'ws';
import {
  parseClientMessage,
  type ActionKind,
  type EnvVar,
  type ServerMessage,
} from '@flightdeck/protocol';
import type { Context } from './context.js';
import { identityEnabled, permissionsFor, type Principal } from './identity.js';
import { RateLimiter } from './ratelimit.js';

/** Max distinct services one browser socket may subscribe to. */
const MAX_SUBSCRIPTIONS = 50;
/** Drop live frames once the socket's outbound buffer exceeds this (slow consumer). */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

/**
 * Wire a browser socket into the store: push the live service list, on
 * `subscribe` replay the recent log tail then stream new events, and on
 * `action` dispatch an allowlisted command to the owning agent (auditing it).
 */
export function handleClientConnection(
  ws: WebSocket,
  ctx: Context,
  actor: string,
  principal?: Principal,
): void {
  const { store, commands, config, audit, metrics, deploys } = ctx;
  const unsubscribers = new Map<string, () => void>();
  const actionLimiter = new RateLimiter(config.actionRatePerMin, 60_000);

  // When identity is enforced, gate actions on the `act` permission and
  // attribute the audit entry to the user rather than the socket address.
  const idEnabled = identityEnabled(config);
  const perms = principal
    ? permissionsFor(principal, config.operatorRoles, config.adminRoles)
    : undefined;
  const canAct = !idEnabled || (perms?.has('act') ?? false);
  // Editing env writes secrets, so it needs the stronger reveal (admin) permission.
  const canReveal = !idEnabled || (perms?.has('reveal') ?? false);
  const who = principal ? (principal.name ?? principal.subject) : actor;

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
        // Push the latest known deploy for this service's repo, if any.
        const svc = store.getService(msg.serviceId);
        if (svc?.repo) {
          const serviceId = msg.serviceId;
          void deploys.latestForRepo(svc.repo, svc.environment).then((latest) => {
            if (latest) send({ type: 'deploy', serviceId, deploy: latest });
          });
        }
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
      case 'set_env': {
        void handleSetEnv(msg.serviceId, msg.env);
        return;
      }
    }
  });

  async function handleAction(serviceId: string, action: ActionKind): Promise<void> {
    const finish = (ok: boolean, error?: string): void => {
      audit.record({ ts: Date.now(), action, serviceId, actor: who, ok, error });
      metrics.incAction(action, ok);
      send({ type: 'action_result', serviceId, action, ok, error });
    };

    // Rate limit before anything else, so a spammer cannot flood the audit log.
    if (!actionLimiter.allow()) {
      send({ type: 'action_result', serviceId, action, ok: false, error: 'rate limited' });
      return;
    }
    if (!canAct) {
      finish(false, 'forbidden: operator role required');
      return;
    }
    if (!config.actionsEnabled) {
      finish(false, 'actions are disabled');
      return;
    }
    const service = store.getService(serviceId);
    if (!service) {
      finish(false, 'unknown service');
      return;
    }
    const outcome = await commands.dispatch(serviceId, action, service.containerId);
    finish(outcome.ok, outcome.error);
  }

  async function handleSetEnv(serviceId: string, env: EnvVar[]): Promise<void> {
    const finish = (ok: boolean, error?: string): void => {
      audit.record({ ts: Date.now(), action: 'set_env', serviceId, actor: who, ok, error });
      metrics.incAction('set_env', ok);
      send({ type: 'action_result', serviceId, action: 'set_env', ok, error });
    };

    if (!actionLimiter.allow()) {
      send({
        type: 'action_result',
        serviceId,
        action: 'set_env',
        ok: false,
        error: 'rate limited',
      });
      return;
    }
    if (!canReveal) {
      finish(false, 'forbidden: admin role required');
      return;
    }
    if (!config.actionsEnabled) {
      finish(false, 'actions are disabled');
      return;
    }
    const service = store.getService(serviceId);
    if (!service) {
      finish(false, 'unknown service');
      return;
    }
    const outcome = await commands.dispatch(serviceId, 'set_env', service.containerId, env);
    // Reflect the new env immediately; the agent will also re-report it on its
    // next discovery scan of the recreated container.
    if (outcome.ok) store.setEnv(serviceId, env);
    finish(outcome.ok, outcome.error);
  }

  ws.on('close', () => {
    unsubServices();
    for (const unsub of unsubscribers.values()) {
      unsub();
    }
    unsubscribers.clear();
  });
}
