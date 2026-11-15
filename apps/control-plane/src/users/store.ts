import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { Role, User } from './types.js';

const SCRYPT_KEYLEN = 64;

/** Hash a password with a fresh salt. Stored as `scrypt$<saltHex>$<hashHex>`. */
function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Verify a password against a stored `scrypt$salt$hash`, constant-time. */
function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1] ?? '', 'hex');
  const expected = Buffer.from(parts[2] ?? '', 'hex');
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

interface Row {
  id: string;
  username: string;
  password_hash: string;
  roles: string;
  disabled: number;
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
}

function toUser(r: Row): User {
  return {
    id: r.id,
    username: r.username,
    roles: JSON.parse(r.roles) as Role[],
    disabled: r.disabled === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastLoginAt: r.last_login_at,
  };
}

/**
 * SQLite-backed store of local users. Default is in-memory (ephemeral — fine for
 * tests); pass a file to persist across restarts, which any real deployment
 * using local users must do.
 *
 * SECURITY: passwords are stored only as scrypt hashes with a per-user salt. The
 * hash is never returned; toUser() omits it entirely.
 */
export class UserStore {
  private readonly db: DatabaseSync;

  constructor(file: string = ':memory:') {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        roles TEXT NOT NULL,
        disabled INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_login_at INTEGER
      );
    `);
  }

  list(): User[] {
    return (
      this.db
        .prepare('SELECT * FROM users ORDER BY username COLLATE NOCASE')
        .all() as unknown as Row[]
    ).map(toUser);
  }

  get(id: string): User | null {
    const r = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as
      Row | undefined;
    return r ? toUser(r) : null;
  }

  getByUsername(username: string): User | null {
    const r = this.db
      .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
      .get(username) as unknown as Row | undefined;
    return r ? toUser(r) : null;
  }

  get count(): number {
    const r = this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    return r.n;
  }

  /** How many admins are currently enabled — used to protect the last admin. */
  get enabledAdminCount(): number {
    let n = 0;
    for (const u of this.list()) if (!u.disabled && u.roles.includes('admin')) n++;
    return n;
  }

  /** Create a user. Throws if the username is taken (UNIQUE constraint). */
  create(username: string, password: string, roles: Role[]): User {
    const id = `u_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO users (id, username, password_hash, roles, disabled, created_at, updated_at, last_login_at) VALUES (?, ?, ?, ?, 0, ?, ?, NULL)',
      )
      .run(id, username, hashPassword(password), JSON.stringify(roles), now, now);
    return toUser(this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as Row);
  }

  setRoles(id: string, roles: Role[]): User | null {
    const res = this.db
      .prepare('UPDATE users SET roles = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(roles), Date.now(), id);
    return res.changes > 0 ? this.get(id) : null;
  }

  setDisabled(id: string, disabled: boolean): User | null {
    const res = this.db
      .prepare('UPDATE users SET disabled = ?, updated_at = ? WHERE id = ?')
      .run(disabled ? 1 : 0, Date.now(), id);
    return res.changes > 0 ? this.get(id) : null;
  }

  setPassword(id: string, password: string): boolean {
    const res = this.db
      .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(hashPassword(password), Date.now(), id);
    return res.changes > 0;
  }

  delete(id: string): boolean {
    const res = this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return res.changes > 0;
  }

  /**
   * Verify a username/password. Returns the user on success, or null if the user
   * is unknown, disabled, or the password is wrong. Always runs a scrypt compare
   * (against a dummy hash for unknown users) so timing does not reveal existence.
   */
  verifyCredentials(username: string, password: string): User | null {
    const r = this.db
      .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
      .get(username) as unknown as Row | undefined;
    const stored = r?.password_hash ?? 'scrypt$00$00';
    const ok = verifyPassword(password, stored);
    if (!r || !ok || r.disabled === 1) return null;
    return toUser(r);
  }

  touchLogin(id: string): void {
    this.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), id);
  }
}
