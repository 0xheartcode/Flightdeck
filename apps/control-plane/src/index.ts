import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { startControlPlane } from './server.js';

const handle = startControlPlane(loadConfig());
const log = logger.child({ component: 'control-plane' });

function shutdown(signal: string): void {
  log.info({ signal }, 'shutting down');
  void handle.close().finally(() => process.exit(0));
  // Force-exit if connections do not drain promptly.
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
