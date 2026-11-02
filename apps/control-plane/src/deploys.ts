import { DatabaseSync } from 'node:sqlite';
import type { DeployRecord, DeployStatus } from '@flightdeck/protocol';
import type { Config } from './config.js';
import { logger } from './logger.js';
import { PgDeployStore } from './pg-deploys.js';

const log = logger.child({ component: 'deploys' });

/**
 * Durable store of observed deployments. The interface is async and small so
 * the backend is pluggable: SQLite (Node's built-in node:sqlite, no native
 * dependency) for a single instance, or Postgres for a highly-available
 * multi-instance deployment where instances share this state.
 */
export interface DeployStore {
  /** Insert a deploy, or update status/url/time if the id already exists. */
  record(d: DeployRecord): Promise<void>;
  list(repo?: string, limit?: number): Promise<DeployRecord[]>;
  latestForRepo(repo: string, environment?: string): Promise<DeployRecord | undefined>;
  close(): Promise<void>;
}

/** Pick the backend: Postgres when FD_DATABASE_URL is set, else SQLite. */
export function createDeployStore(config: Config): DeployStore {
  if (config.databaseUrl) {
    log.info('using Postgres deploy store (HA)');
    return new PgDeployStore(config.databaseUrl);
  }
  return new SqliteDeployStore(config.dbFile);
}

/** SQLite-backed store. Default is in-memory; FD_DB_FILE persists it. */
export class SqliteDeployStore implements DeployStore {
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
    log.info({ file }, 'deploy store ready (sqlite)');
  }

  record(d: DeployRecord): Promise<void> {
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
    return Promise.resolve();
  }

  list(repo?: string, limit = 50): Promise<DeployRecord[]> {
    const rows = repo
      ? this.db
          .prepare('SELECT * FROM deploys WHERE repo = ? ORDER BY updated_at DESC LIMIT ?')
          .all(repo, limit)
      : this.db.prepare('SELECT * FROM deploys ORDER BY updated_at DESC LIMIT ?').all(limit);
    return Promise.resolve(rows.map(rowToDeploy));
  }

  latestForRepo(repo: string, environment?: string): Promise<DeployRecord | undefined> {
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
    return Promise.resolve(row ? rowToDeploy(row) : undefined);
  }

  close(): Promise<void> {
    this.db.close();
    return Promise.resolve();
  }
}

export function rowToDeploy(r: Record<string, unknown>): DeployRecord {
  return {
    id: r.id as string,
    repo: r.repo as string,
    environment: (r.environment as string | null) ?? undefined,
    sha: r.sha as string,
    branch: (r.branch as string | null) ?? undefined,
    status: r.status as DeployStatus,
    runUrl: (r.run_url as string | null) ?? undefined,
    actor: (r.actor as string | null) ?? undefined,
    startedAt: Number(r.started_at),
    updatedAt: Number(r.updated_at),
  };
}
