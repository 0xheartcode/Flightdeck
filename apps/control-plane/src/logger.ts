import { pino, type Logger } from 'pino';

/**
 * Root structured logger. JSON by default (production), pretty on a TTY (dev).
 *   FD_LOG_LEVEL  - trace|debug|info|warn|error|fatal (default info)
 *   FD_LOG_PRETTY - "true"/"false" to force pretty on/off (default: auto by TTY)
 *
 * Child loggers add context (component, agent, connection id); token and
 * authorization fields are redacted so secrets never reach the logs.
 */
const level = process.env.FD_LOG_LEVEL ?? 'info';
const prettyEnv = process.env.FD_LOG_PRETTY;
const pretty = prettyEnv === 'true' || (prettyEnv !== 'false' && process.stdout.isTTY === true);

const redact = {
  paths: ['token', 'authorization', 'headers.authorization', '*.token', '*.authorization'],
  censor: '[redacted]',
};

export const logger: Logger = pretty
  ? pino({
      level,
      redact,
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
      },
    })
  : // Synchronous stdout so a crash or shutdown does not drop buffered logs.
    // The control plane's log volume is modest, so sync is fine here.
    pino({ level, redact }, pino.destination({ sync: true }));
