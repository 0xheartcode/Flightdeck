import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { AgentToken, AgentTokenSecret } from './types.js';

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Constant-time hex-digest comparison. */
function hashEq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

interface Row {
  id: string;
  name: string;
  token_hash: string;
  hint: string;
  created_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
}

function toToken(r: Row): AgentToken {
  return {
    id: r.id,
    name: r.name,
    hint: r.hint,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    revokedAt: r.revoked_at,
  };
}

/**
 * SQLite-backed store of managed agent credentials. Default is in-memory; pass a
 * file to persist across restarts.
 *
 * SECURITY: the plaintext token is never stored. Each row keeps a SHA-256 hash
 * and a 4-char hint; the plaintext is returned exactly once (create/rotate).
 * verify() is constant-time over the hash and ignores revoked rows.
 */
export class AgentTokenStore {
  private readonly db: DatabaseSync;

  // node:sqlite returns rows as Record<string, SQLOutputValue>; our columns are
  // all declared, so a checked cast through unknown to the row shape is safe.
  constructor(file: string = ':memory:') {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_tokens (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        hint TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER,
        revoked_at INTEGER
      );
    `);
  }

  /** All tokens, active and revoked, newest first. Never includes the secret. */
  list(): AgentToken[] {
    return (
      this.db
        .prepare('SELECT * FROM agent_tokens ORDER BY created_at DESC')
        .all() as unknown as Row[]
    ).map(toToken);
  }

  /** Issue a new token. Returns the row and the plaintext (shown once). */
  create(name: string): AgentTokenSecret {
    const secret = randomBytes(24).toString('base64url');
    const id = `at_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const now = Date.now();
    const hint = secret.slice(-4);
    this.db
      .prepare(
        'INSERT INTO agent_tokens (id, name, token_hash, hint, created_at, last_seen_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL, NULL)',
      )
      .run(id, name, sha256(secret), hint, now);
    const row = this.db
      .prepare('SELECT * FROM agent_tokens WHERE id = ?')
      .get(id) as unknown as Row;
    return { token: toToken(row), secret };
  }

  /** Replace a token's secret in place (keeps its id and name). Returns the new plaintext. */
  rotate(id: string): AgentTokenSecret | null {
    const row = this.db.prepare('SELECT * FROM agent_tokens WHERE id = ?').get(id) as unknown as
      Row | undefined;
    if (!row) return null;
    const secret = randomBytes(24).toString('base64url');
    const hint = secret.slice(-4);
    this.db
      .prepare(
        'UPDATE agent_tokens SET token_hash = ?, hint = ?, revoked_at = NULL, last_seen_at = NULL WHERE id = ?',
      )
      .run(sha256(secret), hint, id);
    const updated = this.db
      .prepare('SELECT * FROM agent_tokens WHERE id = ?')
      .get(id) as unknown as Row;
    return { token: toToken(updated), secret };
  }

  /** Mark a token revoked. It can no longer authenticate but stays listed. */
  revoke(id: string): boolean {
    const res = this.db
      .prepare('UPDATE agent_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
      .run(Date.now(), id);
    return res.changes > 0;
  }

  /** Remove a token entirely. */
  delete(id: string): boolean {
    const res = this.db.prepare('DELETE FROM agent_tokens WHERE id = ?').run(id);
    return res.changes > 0;
  }

  /**
   * Resolve a presented token to its agent name, or null if unknown or revoked.
   * Hashes the input once and compares against every active row in constant
   * time; records lastSeen on a match.
   */
  verify(token: string | undefined): string | null {
    if (!token) return null;
    const presented = sha256(token);
    let match: Row | null = null;
    for (const row of this.db
      .prepare('SELECT * FROM agent_tokens WHERE revoked_at IS NULL')
      .all() as unknown as Row[]) {
      if (hashEq(row.token_hash, presented)) match = row;
    }
    if (!match) return null;
    this.db
      .prepare('UPDATE agent_tokens SET last_seen_at = ? WHERE id = ?')
      .run(Date.now(), match.id);
    return match.name;
  }

  /** Number of active (non-revoked) tokens, for diagnostics. */
  get activeCount(): number {
    const r = this.db
      .prepare('SELECT COUNT(*) AS n FROM agent_tokens WHERE revoked_at IS NULL')
      .get() as { n: number };
    return r.n;
  }
}
