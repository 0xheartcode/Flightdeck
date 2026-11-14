import { z } from 'zod';

/**
 * Transmitter wire types (control-plane side). These mirror the web client's
 * contract in apps/web/src/lib/transmitter/types.ts and the spec in
 * docs/design/TRANSMITTER-API.md. Model: sources in -> routes -> channels out.
 *
 * SECURITY: channel credentials are write-only. They are accepted on the input
 * schemas and stored, but the serialised Channel never carries them.
 */

export const Severity = z.enum(['info', 'warning', 'error', 'critical']);
export type Severity = z.infer<typeof Severity>;

/** Severity rank for "at or above" route matching. */
export const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

export const ChannelKind = z.enum(['telegram', 'email', 'discord', 'slack', 'webhook', 'custom']);
export type ChannelKind = z.infer<typeof ChannelKind>;

export const Signal = z.object({
  id: z.string(),
  ts: z.number().int(),
  severity: Severity,
  title: z.string().max(256),
  body: z.string().max(2000).optional(),
  source: z.string(),
  read: z.boolean(),
});
export type Signal = z.infer<typeof Signal>;

/** A new inbound signal (from /ingest or an internal producer). */
export const SignalInput = z.object({
  severity: Severity,
  title: z.string().min(1).max(256),
  body: z.string().max(2000).optional(),
  eventType: z.string().max(128).optional(),
  project: z.string().max(256).optional(),
});
export type SignalInput = z.infer<typeof SignalInput>;

export const Channel = z.object({
  id: z.string(),
  kind: ChannelKind,
  name: z.string().max(128),
  config: z.record(z.string(), z.string()),
  enabled: z.boolean(),
  credentialSet: z.boolean(),
  credentialUpdatedAt: z.number().int().optional(),
});
export type Channel = z.infer<typeof Channel>;

export const ChannelInput = z.object({
  kind: ChannelKind,
  name: z.string().min(1).max(128),
  config: z.record(z.string(), z.string().max(2048)),
  enabled: z.boolean(),
  /** Write-only; stored but never returned. Omit on update to keep the existing one. */
  credential: z.string().max(4096).optional(),
});
export type ChannelInput = z.infer<typeof ChannelInput>;

export const RouteMatch = z.object({
  eventTypes: z.array(z.string().max(128)).max(50),
  minSeverity: Severity,
  projects: z.array(z.string().max(256)).max(50),
});

export const RouteRule = z.object({
  id: z.string(),
  name: z.string().max(128),
  match: RouteMatch,
  channelIds: z.array(z.string()).max(50),
  throttlePerMin: z.number().int().positive().max(10000).optional(),
  quietHours: z.object({ start: z.string(), end: z.string() }).optional(),
  muted: z.boolean(),
});
export type RouteRule = z.infer<typeof RouteRule>;

export const RouteInput = RouteRule.omit({ id: true });
export type RouteInput = z.infer<typeof RouteInput>;

export const SourceKind = z.enum(['builtin', 'webhook']);
export type SourceKind = z.infer<typeof SourceKind>;

export const Source = z.object({
  id: z.string(),
  kind: SourceKind,
  name: z.string().max(128),
  enabled: z.boolean(),
  tokenHint: z.string().max(8).optional(),
  createdAt: z.number().int(),
});
export type Source = z.infer<typeof Source>;

export const SourceInput = z.object({ name: z.string().min(1).max(128) });
export type SourceInput = z.infer<typeof SourceInput>;

export const Delivery = z.object({
  id: z.string(),
  ts: z.number().int(),
  channelId: z.string(),
  channelName: z.string(),
  routeId: z.string().optional(),
  signalTitle: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
});
export type Delivery = z.infer<typeof Delivery>;

/** The one-time secret returned when a webhook source is created or rotated. */
export interface SourceSecret {
  source: Source;
  token: string;
}
