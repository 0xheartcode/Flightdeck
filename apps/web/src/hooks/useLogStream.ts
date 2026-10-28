import { useEffect, useState } from 'react';
import type { LogLine, ServerMessage } from '@flightdeck/protocol';
import { streamUrl } from '@/api';

const MAX_LINES = 2000;

export interface LogStream {
  logs: LogLine[];
  connected: boolean;
}

/**
 * Open a dedicated WebSocket for the selected service: on connect, subscribe
 * and receive a snapshot of the recent tail, then stream new lines live.
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

    const ws = new WebSocket(streamUrl());

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: 'subscribe', serviceId }));
    };
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
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

    return () => {
      ws.close();
    };
  }, [serviceId]);

  return { logs, connected };
}
