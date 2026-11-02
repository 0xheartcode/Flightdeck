import pg from 'pg';
import type { DeployRecord } from '@flightdeck/protocol';
import { rowToDeploy, type DeployStore } from './deploys.js';
import { logger } from './logger.js';

const { Pool } = pg;
const log = logger.child({ component: 'deploys' });

type Row = Record<string, unknown>;

/**
 * Postgres-backed deploy store for highly-available, multi-instance control
 * planes: every instance shares this durable state. The schema is created on
 * first use; each query waits for that. BIGINT holds the millisecond epochs
 * (pg returns them as strings, which rowToDeploy coerces).
 */
export class PgDeployStore implements DeployStore {
  private readonly pool: pg.Pool;
  private readonly ready: Promise<void>;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS deploys (
        id          TEXT PRIMARY KEY,
        repo        TEXT NOT NULL,
        environment TEXT,
        sha         TEXT NOT NULL,
        branch      TEXT,
        status      TEXT NOT NULL,
        run_url     TEXT,
        actor       TEXT,
        started_at  BIGINT NOT NULL,
        updated_at  BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS deploys_repo_updated ON deploys (repo, updated_at DESC);
    `);
    log.info('deploy store ready (postgres)');
  }

  async record(d: DeployRecord): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO deploys
         (id, repo, environment, sha, branch, status, run_url, actor, started_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         run_url = EXCLUDED.run_url,
         updated_at = EXCLUDED.updated_at`,
      [
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
      ],
    );
  }

  async list(repo?: string, limit = 50): Promise<DeployRecord[]> {
    await this.ready;
    const res = repo
      ? await this.pool.query<Row>(
          'SELECT * FROM deploys WHERE repo = $1 ORDER BY updated_at DESC LIMIT $2',
          [repo, limit],
        )
      : await this.pool.query<Row>('SELECT * FROM deploys ORDER BY updated_at DESC LIMIT $1', [
          limit,
        ]);
    return res.rows.map(rowToDeploy);
  }

  async latestForRepo(repo: string, environment?: string): Promise<DeployRecord | undefined> {
    await this.ready;
    const res = environment
      ? await this.pool.query<Row>(
          `SELECT * FROM deploys WHERE repo = $1 AND (environment = $2 OR environment IS NULL)
           ORDER BY updated_at DESC LIMIT 1`,
          [repo, environment],
        )
      : await this.pool.query<Row>(
          'SELECT * FROM deploys WHERE repo = $1 ORDER BY updated_at DESC LIMIT 1',
          [repo],
        );
    const row = res.rows[0];
    return row ? rowToDeploy(row) : undefined;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
