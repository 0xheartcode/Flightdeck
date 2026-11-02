import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ActionKind,
  DeployRecord,
  LogLine,
  ServerMessage,
  ServiceState,
  Stats,
} from '@flightdeck/protocol';
import { streamUrl } from '@/api';

const MAX_LINES = 2000;
const RECONNECT_MS = 2000;

export interface LiveStatus {
  state: ServiceState;
  exitCode?: number;
}

export interface ActionResult {
  action: ActionKind;
  ok: boolean;
  error?: string;
}

export interface LogStream {
  logs: LogLine[];
  connected: boolean;
  stats: Stats | null;
  status: LiveStatus | null;
  actionResult: ActionResult | null;
  actionPending: boolean;
  deploy: DeployRecord | null;
  sendAction: (action: ActionKind) => void;
}

/**
 * Open a WebSocket for the selected service: on connect, subscribe and receive
 * a snapshot of the recent tail, then stream new lines live. Reconnects with a
 * fixed backoff so a control-plane restart recovers on its own. Also sends
 * operator actions (restart) and surfaces their result.
 */
export function useLogStream(serviceId: string | null): LogStream {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [actionResult, setActionResult] = useState<ActionResult | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [deploy, setDeploy] = useState<DeployRecord | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    setLogs([]);
    setConnected(false);
    setStats(null);
    setStatus(null);
    setActionResult(null);
    setActionPending(false);
    setDeploy(null);
    if (!serviceId) {
      return;
    }

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const connect = (): void => {
      if (closed) return;
      ws = new WebSocket(streamUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        ws?.send(JSON.stringify({ type: 'subscribe', serviceId }));
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) {
          reconnectTimer = setTimeout(connect, RECONNECT_MS);
        }
      };
      ws.onerror = () => {
        // onclose fires after onerror and drives the reconnect.
        ws?.close();
      };
      ws.onmessage = (ev: MessageEvent<string>) => {
        const msg = JSON.parse(ev.data) as ServerMessage;
        if (msg.type === 'snapshot' && msg.serviceId === serviceId) {
          setLogs(msg.logs.slice(-MAX_LINES));
        } else if (msg.type === 'log' && msg.log.serviceId === serviceId) {
          setLogs((prev) => {
            const next = [...prev, msg.log];
            return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
          });
        } else if (msg.type === 'stats' && msg.stats.serviceId === serviceId) {
          setStats(msg.stats);
        } else if (msg.type === 'status' && msg.serviceId === serviceId) {
          setStatus({ state: msg.state, exitCode: msg.exitCode });
        } else if (msg.type === 'action_result' && msg.serviceId === serviceId) {
          setActionPending(false);
          setActionResult({ action: msg.action, ok: msg.ok, error: msg.error });
        } else if (msg.type === 'deploy' && msg.serviceId === serviceId) {
          setDeploy(msg.deploy);
        }
      };
    };

    connect();

    return () => {
      closed = true;
      wsRef.current = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [serviceId]);

  const sendAction = useCallback(
    (action: ActionKind) => {
      const ws = wsRef.current;
      if (!serviceId || !ws || ws.readyState !== WebSocket.OPEN) return;
      setActionResult(null);
      setActionPending(true);
      ws.send(JSON.stringify({ type: 'action', action, serviceId }));
    },
    [serviceId],
  );

  return { logs, connected, stats, status, actionResult, actionPending, deploy, sendAction };
}
