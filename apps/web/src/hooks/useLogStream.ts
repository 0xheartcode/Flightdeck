import { useEffect, useState } from 'react';
import type { LogLine, ServerMessage } from '@flightdeck/protocol';
import { streamUrl } from '@/api';

const MAX_LINES = 2000;
const RECONNECT_MS = 2000;

export interface LogStream {
  logs: LogLine[];
  connected: boolean;
}

/**
 * Open a WebSocket for the selected service: on connect, subscribe and receive
 * a snapshot of the recent tail, then stream new lines live. Reconnects with a
 * fixed backoff so a control-plane restart recovers on its own.
 */
export function useLogStream(serviceId: string | null): LogStream {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setLogs([]);
    setConnected(false);
    if (!serviceId) {
      return;
    }

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const connect = (): void => {
      if (closed) return;
      ws = new WebSocket(streamUrl());

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
        }
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [serviceId]);

  return { logs, connected };
}
