import { DatabaseSync } from 'node:sqlite';
import type { DeployRecord, DeployStatus } from '@flightdeck/protocol';
import { logger } from './logger.js';

const log = logger.child({ component: 'deploys' });

/**
 * Durable store of observed deployments, backed by SQLite (Node's built-in
 * node:sqlite, so no native dependency). Default is in-memory; set a file path
 * (FD_DB_FILE) to persist across restarts. The interface is deliberately small
 * so a Postgres-backed implementation can slot in later for HA.
 */
export class DeployStore {
  private readonly db: DatabaseSync;

  constructor(file: string = ':memory:') {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS deploys (
        id          TEXT PRIMARY KEY,
        repo        TEXT NOT NULL,
        environment TEXT,
        sha         TEXT NOT NULL,
        branch      TEXT,
        status      TEXT NOT NULL,
        run_url     TEXT,
        actor       TEXT,
        started_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS deploys_repo_updated ON deploys (repo, updated_at DESC);
    `);
    log.info({ file }, 'deploy store ready');
  }

  /** Insert a deploy, or update status/url/time if the id already exists. */
  record(d: DeployRecord): void {
    this.db
      .prepare(
        `INSERT INTO deploys
           (id, repo, environment, sha, branch, status, run_url, actor, started_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           run_url = excluded.run_url,
           updated_at = excluded.updated_at`,
      )
      .run(
        d.id,
        d.repo,
        d.environment ?? null,
        d.sha,
        d.branch ?? null,
        d.status,
        d.runUrl ?? null,
        d.actor ?? null,
        d.startedAt,
        d.updatedAt,
      );
  }

  list(repo?: string, limit = 50): DeployRecord[] {
    const rows = repo
      ? this.db
          .prepare('SELECT * FROM deploys WHERE repo = ? ORDER BY updated_at DESC LIMIT ?')
          .all(repo, limit)
      : this.db.prepare('SELECT * FROM deploys ORDER BY updated_at DESC LIMIT ?').all(limit);
    return rows.map(rowToDeploy);
  }

  latestForRepo(repo: string, environment?: string): DeployRecord | undefined {
    const row = environment
      ? this.db
          .prepare(
            `SELECT * FROM deploys WHERE repo = ? AND (environment = ? OR environment IS NULL)
             ORDER BY updated_at DESC LIMIT 1`,
          )
          .get(repo, environment)
      : this.db
          .prepare('SELECT * FROM deploys WHERE repo = ? ORDER BY updated_at DESC LIMIT 1')
          .get(repo);
    return row ? rowToDeploy(row) : undefined;
  }

  close(): void {
    this.db.close();
  }
}

function rowToDeploy(r: Record<string, unknown>): DeployRecord {
  return {
    id: r.id as string,
    repo: r.repo as string,
    environment: (r.environment as string | null) ?? undefined,
    sha: r.sha as string,
    branch: (r.branch as string | null) ?? undefined,
    status: r.status as DeployStatus,
    runUrl: (r.run_url as string | null) ?? undefined,
    actor: (r.actor as string | null) ?? undefined,
    startedAt: r.started_at as number,
    updatedAt: r.updated_at as number,
  };
}
