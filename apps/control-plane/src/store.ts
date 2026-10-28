import type {
  LogLine,
  ServerMessage,
  ServiceInfo,
  ServiceState,
  Stats,
} from '@flightdeck/protocol';

type Listener = (msg: ServerMessage) => void;
type ServicesListener = (services: ServiceInfo[]) => void;

/**
 * In-memory state for the control plane: the service registry, a bounded
 * ring buffer of recent logs per service, and the fan-out machinery that
 * pushes live events to subscribed browser sockets.
 *
 * This is deliberately not durable. Logs are a short tail for "what just
 * happened"; long-term log storage is a later concern (ship to Loki).
 */
export class Store {
  private readonly services = new Map<string, ServiceInfo>();
  private readonly logs = new Map<string, LogLine[]>();
  private readonly serviceListeners = new Map<string, Set<Listener>>();
  private readonly servicesListeners = new Set<ServicesListener>();

  constructor(private readonly bufferSize: number) {}

  listServices(): ServiceInfo[] {
    return [...this.services.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  getService(id: string): ServiceInfo | undefined {
    return this.services.get(id);
  }

  recentLogs(id: string): LogLine[] {
    return this.logs.get(id) ?? [];
  }

  upsertService(service: ServiceInfo): void {
    this.services.set(service.id, service);
    if (!this.logs.has(service.id)) {
      this.logs.set(service.id, []);
    }
    this.emitServices();
  }

  removeService(id: string): void {
    if (this.services.delete(id)) {
      this.emitServices();
    }
  }

  setStatus(
    serviceId: string,
    state: ServiceState,
    exitCode: number | undefined,
    ts: number,
  ): void {
    const svc = this.services.get(serviceId);
    if (svc) {
      svc.state = state;
      this.emitServices();
    }
    this.fanout(serviceId, { type: 'status', serviceId, state, exitCode, ts });
  }

  appendLog(log: LogLine): void {
    const buf = this.logs.get(log.serviceId) ?? [];
    buf.push(log);
    if (buf.length > this.bufferSize) {
      buf.splice(0, buf.length - this.bufferSize);
    }
    this.logs.set(log.serviceId, buf);
    this.fanout(log.serviceId, { type: 'log', log });
  }

  setStats(stats: Stats): void {
    this.fanout(stats.serviceId, { type: 'stats', stats });
  }

  /** Subscribe to live events (logs, status, stats) for one service. */
  subscribe(serviceId: string, listener: Listener): () => void {
    const set = this.serviceListeners.get(serviceId) ?? new Set<Listener>();
    set.add(listener);
    this.serviceListeners.set(serviceId, set);
    return () => {
      set.delete(listener);
    };
  }

  /** Subscribe to the service list (fires on every registry change). */
  subscribeServices(listener: ServicesListener): () => void {
    this.servicesListeners.add(listener);
    return () => {
      this.servicesListeners.delete(listener);
    };
  }

  private fanout(serviceId: string, msg: ServerMessage): void {
    const set = this.serviceListeners.get(serviceId);
    if (!set) return;
    for (const listener of set) {
      listener(msg);
    }
  }

  private emitServices(): void {
    const services = this.listServices();
    for (const listener of this.servicesListeners) {
      listener(services);
    }
  }
}
