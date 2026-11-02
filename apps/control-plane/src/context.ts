import type { AuditLog } from './audit.js';
import type { Bus } from './bus.js';
import type { CommandBus } from './commands.js';
import type { Config } from './config.js';
import type { DeployStore } from './deploys.js';
import type { KeyResolver } from './identity.js';
import type { LokiClient } from './loki.js';
import type { Metrics } from './metrics.js';
import type { Store } from './store.js';

/** Shared services wired once at startup and passed to the connection hubs. */
export interface Context {
  config: Config;
  store: Store;
  commands: CommandBus;
  audit: AuditLog;
  metrics: Metrics;
  deploys: DeployStore;
  /** JWKS key cache for RS256 verification, when a JWKS URI is configured. */
  jwks?: KeyResolver;
  /** Durable log shipping and search, when a Loki URL is configured. */
  loki?: LokiClient;
  /** Inter-instance fan-out bus for HA (no-op when single-instance). */
  bus: Bus;
}
