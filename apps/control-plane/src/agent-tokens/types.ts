import { z } from 'zod';

/**
 * A managed agent credential. The token itself is never stored or returned in
 * full after creation: the store keeps a SHA-256 hash plus a short hint, and the
 * plaintext is shown exactly once at issue/rotate time.
 */
export const AgentToken = z.object({
  id: z.string(),
  /** The agent identity this token authenticates (becomes the agent name). */
  name: z.string(),
  /** Last 4 characters of the plaintext token, for recognition in the UI. */
  hint: z.string(),
  createdAt: z.number(),
  /** Last time a connection authenticated with this token, if ever. */
  lastSeenAt: z.number().nullable(),
  /** When revoked; a revoked token never authenticates again. */
  revokedAt: z.number().nullable(),
});
export type AgentToken = z.infer<typeof AgentToken>;

export const AgentTokenInput = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(64)
    // A token name is used as the agent identity and appears in logs/audit.
    .regex(/^[A-Za-z0-9._-]+$/, 'letters, digits, dot, underscore or hyphen only'),
});
export type AgentTokenInput = z.infer<typeof AgentTokenInput>;

/** The one-time response when a token is issued or rotated. */
export interface AgentTokenSecret {
  token: AgentToken;
  /** Plaintext, returned exactly once. */
  secret: string;
}
