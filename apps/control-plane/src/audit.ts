import { appendFileSync } from 'node:fs';
import type { CommandAction } from '@flightdeck/protocol';
import { logger } from './logger.js';

const log = logger.child({ component: 'audit' });

export interface AuditEntry {
  ts: number;
  action: CommandAction;
  serviceId: string;
  /** Who triggered it (client address/identifier). */
  actor: string;
  ok: boolean;
  error?: string;
}

/**
 * Records operator actions: who triggered what, when, and the outcome. Entries
 * go to the structured log, to an in-memory ring (served at /api/audit), and,
 * if a file is configured, appended as JSONL so the trail survives a restart.
 */
export class AuditLog {
  private readonly recent: AuditEntry[] = [];

  constructor(
    private readonly max: number = 500,
    private readonly file?: string,
  ) {}

  record(entry: AuditEntry): void {
    this.recent.push(entry);
    if (this.recent.length > this.max) {
      this.recent.splice(0, this.recent.length - this.max);
    }
    log.info(entry, 'action');
    if (this.file) {
      try {
        appendFileSync(this.file, JSON.stringify(entry) + '\n');
      } catch (err) {
        log.warn({ err: (err as Error).message }, 'audit file write failed');
      }
    }
  }

  /** Recent entries, newest first. */
  list(limit?: number): AuditEntry[] {
    const newestFirst = [...this.recent].reverse();
    return limit ? newestFirst.slice(0, limit) : newestFirst;
  }
}
