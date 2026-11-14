import type { IconName } from '@/components/ui';

/**
 * Transmitter domain types — the shared contract between the UI and whatever
 * backend eventually implements it. The model is: sources in → routes → channels
 * out. No Transmitter backend exists in this repo yet, so the UI runs against a
 * typed client (TransmitterClient) with a mock adapter in dev/tests. The wire
 * contract for the backend team is in docs/design/TRANSMITTER-API.md.
 *
 * SECURITY: credentials (bot tokens, SMTP passwords, webhook secrets) are
 * write-only. They are accepted on create/update but NEVER returned. The client
 * surfaces only whether a credential is set and when it was last updated.
 */

export type Severity = 'info' | 'warning' | 'error' | 'critical';

export const SEVERITIES: Severity[] = ['info', 'warning', 'error', 'critical'];

export type ChannelKind = 'telegram' | 'email' | 'discord' | 'slack' | 'webhook' | 'custom';

export const CHANNEL_KINDS: ChannelKind[] = [
  'telegram',
  'email',
  'discord',
  'slack',
  'webhook',
  'custom',
];

/** An in-app notification shown in the Transmitter signal feed. */
export interface Signal {
  id: string;
  ts: number;
  severity: Severity;
  title: string;
  body?: string;
  /** Source id that produced it. */
  source: string;
  read: boolean;
}

/**
 * An outbound channel. `config` holds non-secret fields (chat id, from address,
 * webhook URL…). Secrets are write-only: `credentialSet` reflects whether one is
 * stored; the value is never returned.
 */
export interface Channel {
  id: string;
  kind: ChannelKind;
  name: string;
  /** Non-secret configuration, kind-specific (e.g. { chatId }, { url }). */
  config: Record<string, string>;
  enabled: boolean;
  credentialSet: boolean;
  credentialUpdatedAt?: number;
}

export interface ChannelInput {
  kind: ChannelKind;
  name: string;
  config: Record<string, string>;
  enabled: boolean;
  /** Write-only. Sent on create/replace; never read back. Omit to keep existing. */
  credential?: string;
}

/** A routing rule: match incoming signals and fan them out to channels. */
export interface RouteRule {
  id: string;
  name: string;
  match: {
    /** Empty = any event type. */
    eventTypes: string[];
    /** Minimum severity to match. */
    minSeverity: Severity;
    /** Empty = any project. */
    projects: string[];
  };
  channelIds: string[];
  /** Max sends per minute (undefined = unthrottled). */
  throttlePerMin?: number;
  /** Local-time quiet window during which sends are suppressed. */
  quietHours?: { start: string; end: string };
  muted: boolean;
}

export type RouteInput = Omit<RouteRule, 'id'>;

export type SourceKind = 'builtin' | 'webhook';

/**
 * An inbound source. Builtin is Flightdeck's own events (always on, no token).
 * Webhook sources accept pushes authenticated by a per-source token that is
 * hashed at rest and shown exactly once at creation/rotation.
 */
export interface Source {
  id: string;
  kind: SourceKind;
  name: string;
  enabled: boolean;
  /** Last 4 chars of the token, for identification. Never the full token. */
  tokenHint?: string;
  createdAt: number;
}

export interface SourceInput {
  name: string;
}

/** A record of an attempted delivery to a channel. */
export interface Delivery {
  id: string;
  ts: number;
  channelId: string;
  channelName: string;
  routeId?: string;
  signalTitle: string;
  ok: boolean;
  error?: string;
}

/** The one-time secret returned when a webhook source is created or rotated. */
export interface SourceSecret {
  source: Source;
  /** Shown once; the backend stores only a hash. */
  token: string;
}

/**
 * The client the UI talks to. A mock adapter implements it in dev/tests; the
 * real backend implements the same shape over HTTP (see TRANSMITTER-API.md).
 */
export interface TransmitterClient {
  listSignals(): Promise<Signal[]>;
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;

  listChannels(): Promise<Channel[]>;
  createChannel(input: ChannelInput): Promise<Channel>;
  updateChannel(id: string, input: ChannelInput): Promise<Channel>;
  deleteChannel(id: string): Promise<void>;
  /** Send a test notification. Never hits a real channel in the mock. */
  testChannel(id: string): Promise<Delivery>;

  listRoutes(): Promise<RouteRule[]>;
  createRoute(input: RouteInput): Promise<RouteRule>;
  updateRoute(id: string, input: RouteInput): Promise<RouteRule>;
  deleteRoute(id: string): Promise<void>;

  listSources(): Promise<Source[]>;
  createSource(input: SourceInput): Promise<SourceSecret>;
  rotateToken(id: string): Promise<SourceSecret>;
  revokeSource(id: string): Promise<void>;

  listDeliveries(): Promise<Delivery[]>;
}

export const CHANNEL_META: Record<
  ChannelKind,
  {
    label: string;
    icon: IconName;
    credentialLabel: string;
    configFields: { key: string; label: string; placeholder: string }[];
  }
> = {
  telegram: {
    label: 'Telegram',
    icon: 'telegram-logo',
    credentialLabel: 'Bot token',
    configFields: [{ key: 'chatId', label: 'Chat ID', placeholder: '-1001234567890' }],
  },
  email: {
    label: 'Email (SMTP)',
    icon: 'envelope-simple',
    credentialLabel: 'SMTP password',
    configFields: [
      { key: 'host', label: 'SMTP host', placeholder: 'smtp.example.com:587' },
      { key: 'from', label: 'From address', placeholder: 'alerts@example.com' },
      { key: 'to', label: 'To address', placeholder: 'oncall@example.com' },
    ],
  },
  discord: {
    label: 'Discord',
    icon: 'discord-logo',
    credentialLabel: 'Webhook secret',
    configFields: [
      { key: 'url', label: 'Webhook URL', placeholder: 'https://discord.com/api/webhooks/…' },
    ],
  },
  slack: {
    label: 'Slack',
    icon: 'slack-logo',
    credentialLabel: 'Webhook secret',
    configFields: [
      { key: 'url', label: 'Webhook URL', placeholder: 'https://hooks.slack.com/services/…' },
    ],
  },
  webhook: {
    label: 'Webhook',
    icon: 'webhooks-logo',
    credentialLabel: 'Signing secret',
    configFields: [{ key: 'url', label: 'Endpoint URL', placeholder: 'https://example.com/hook' }],
  },
  custom: {
    label: 'Custom',
    icon: 'puzzle-piece',
    credentialLabel: 'Secret',
    configFields: [{ key: 'url', label: 'Endpoint URL', placeholder: 'https://example.com/hook' }],
  },
};
