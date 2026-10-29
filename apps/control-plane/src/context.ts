import type { AuditLog } from './audit.js';
import type { CommandBus } from './commands.js';
import type { Config } from './config.js';
import type { Metrics } from './metrics.js';
import type { Store } from './store.js';

/** Shared services wired once at startup and passed to the connection hubs. */
export interface Context {
  config: Config;
  store: Store;
  commands: CommandBus;
  audit: AuditLog;
  metrics: Metrics;
}
