import { existsSync, readFileSync } from 'node:fs';
import { safeEqual } from './auth.js';
import type { Config } from './config.js';
import { logger } from './logger.js';

const log = logger.child({ component: 'credentials' });

export interface AgentCredential {
  name: string;
  token: string;
}

/**
 * Per-agent credentials. Each agent presents its own token, which resolves to
 * a named identity, so a single leaked token can be revoked for one agent
 * without disturbing the others.
 *
 * Sources, in order of precedence:
 *   1. FD_AGENT_TOKENS_FILE - a file of `name:token` lines (hot-reloadable).
 *   2. FD_AGENT_TOKENS       - inline `name:token` entries, comma or newline separated.
 *   3. FD_AGENT_TOKEN        - a single shared token, named "default".
 *
 * Revocation: remove the agent's line from the file. reload() re-reads it, so
 * the agent is rejected on its next connect, and the server also drops any
 * live connection whose credential no longer verifies.
 */
export class CredentialStore {
  private creds: AgentCredential[] = [];

  constructor(private readonly config: Config) {
    this.reload();
  }

  reload(): void {
    this.creds = this.parse();
    if (this.creds.length === 0) {
      log.warn(
        'no agent credentials configured ' +
          '(FD_AGENT_TOKEN / FD_AGENT_TOKENS / FD_AGENT_TOKENS_FILE); all agents will be rejected',
      );
    }
  }

  /** Number of configured credentials (for logging/diagnostics). */
  get size(): number {
    return this.creds.length;
  }

  /**
   * Resolve a presented token to its agent name, or null if unknown.
   * Checks every entry with a constant-time compare and does not early-return,
   * so neither validity nor which entry matched leaks via timing.
   */
  verify(token: string | undefined): string | null {
    if (!token) return null;
    let match: string | null = null;
    for (const c of this.creds) {
      if (safeEqual(c.token, token)) {
        match = c.name;
      }
    }
    return match;
  }

  private parse(): AgentCredential[] {
    if (this.config.agentTokensFile && existsSync(this.config.agentTokensFile)) {
      try {
        return parseEntries(readFileSync(this.config.agentTokensFile, 'utf8'));
      } catch {
        return [];
      }
    }
    if (this.config.agentTokens) {
      return parseEntries(this.config.agentTokens.replace(/,/g, '\n'));
    }
    if (this.config.agentToken) {
      return [{ name: 'default', token: this.config.agentToken }];
    }
    return [];
  }
}

/** Parse `name:token` lines, skipping blanks and `#` comments. */
export function parseEntries(raw: string): AgentCredential[] {
  const out: AgentCredential[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0) continue;
    const name = trimmed.slice(0, idx).trim();
    const token = trimmed.slice(idx + 1).trim();
    if (name && token) {
      out.push({ name, token });
    }
  }
  return out;
}
