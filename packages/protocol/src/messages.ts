import { z } from 'zod';

/**
 * Flightdeck wire protocol, version 1.
 *
 * Three parties speak it:
 *   - the Rust agent (one per server) -> control plane   [AgentMessage]
 *   - the browser UI                 <-> control plane   [ClientMessage / ServerMessage]
 *
 * This file is the single source of truth for the TypeScript side. The Rust
 * agent mirrors these shapes with serde structs (see agent/src/protocol.rs);
 * keep the two in sync when changing anything here.
 */

export const PROTOCOL_VERSION = 1 as const;

/** Lifecycle state of a container, normalised across Docker and Podman. */
export const ServiceState = z.enum([
  'created',
  'running',
  'restarting',
  'paused',
  'exited',
  'dead',
  'removing',
  'unknown',
]);
export type ServiceState = z.infer<typeof ServiceState>;

/**
 * A single environment variable on a service. SENSITIVE: values are secrets.
 * The agent only reports these when configured to (FD_COLLECT_ENV), and the
 * control plane masks the values before serving them to the browser unless the
 * caller has the reveal permission. They are never broadcast over the stream.
 */
export const EnvVar = z.object({
  key: z.string().max(512),
  value: z.string().max(8192),
});
export type EnvVar = z.infer<typeof EnvVar>;

/** A deployable unit the agent is tracking (one labelled container). */
export const ServiceInfo = z.object({
  /** Stable id: the `flightdeck.service` label, else the container name. */
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  image: z.string().max(512),
  containerId: z.string().max(128),
  state: ServiceState,
  /** Hostname of the server this service runs on. */
  host: z.string().max(256),
  createdAt: z.number().int(),
  /** `flightdeck.repo` label (owner/name), for deploy correlation. */
  repo: z.string().max(256).optional(),
  /** `flightdeck.environment` label, for deploy correlation. */
  environment: z.string().max(128).optional(),
  /**
   * Container environment variables (agent -> control plane only). Present
   * only when the agent collects them. The control plane strips this from the
   * registry it broadcasts and serves it separately, masked, so raw values
   * never reach the browser except through the reveal-gated detail endpoint.
   */
  env: z.array(EnvVar).max(1000).optional(),
});
export type ServiceInfo = z.infer<typeof ServiceInfo>;

/** A deployment observed from a CI provider (currently GitHub Actions). */
export const DeployStatus = z.enum(['pending', 'in_progress', 'success', 'failure', 'cancelled']);
export type DeployStatus = z.infer<typeof DeployStatus>;

export const DeployRecord = z.object({
  id: z.string(),
  repo: z.string(),
  environment: z.string().optional(),
  sha: z.string(),
  branch: z.string().optional(),
  status: DeployStatus,
  runUrl: z.string().optional(),
  actor: z.string().optional(),
  startedAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type DeployRecord = z.infer<typeof DeployRecord>;

export const LogStream = z.enum(['stdout', 'stderr']);
export type LogStream = z.infer<typeof LogStream>;

export const LogLine = z.object({
  serviceId: z.string().min(1).max(256),
  stream: LogStream,
  /** Epoch milliseconds. */
  ts: z.number().int(),
  // Bounded so one giant line cannot bloat a frame or the in-memory buffer.
  // The agent truncates at 8 KB; this leaves headroom for multi-byte chars.
  line: z.string().max(16384),
});
export type LogLine = z.infer<typeof LogLine>;

export const Stats = z.object({
  serviceId: z.string(),
  cpuPct: z.number(),
  memBytes: z.number().int(),
  memLimitBytes: z.number().int(),
  ts: z.number().int(),
});
export type Stats = z.infer<typeof Stats>;

const base = { v: z.literal(PROTOCOL_VERSION) };

// --- Agent -> control plane ------------------------------------------------

export const AgentHello = z.object({
  ...base,
  type: z.literal('hello'),
  agentId: z.string().max(256),
  hostname: z.string().max(256),
});

export const AgentService = z.object({
  ...base,
  type: z.literal('service'),
  service: ServiceInfo,
});

export const AgentServiceGone = z.object({
  ...base,
  type: z.literal('service_gone'),
  serviceId: z.string(),
});

export const AgentStatus = z.object({
  ...base,
  type: z.literal('status'),
  serviceId: z.string(),
  state: ServiceState,
  exitCode: z.number().int().optional(),
  ts: z.number().int(),
});

export const AgentLog = z.object({
  ...base,
  type: z.literal('log'),
  log: LogLine,
});

export const AgentStats = z.object({
  ...base,
  type: z.literal('stats'),
  stats: Stats,
});

export const AgentCommandResult = z.object({
  ...base,
  type: z.literal('command_result'),
  id: z.string().max(128),
  ok: z.boolean(),
  error: z.string().max(1024).optional(),
});

export const AgentMessage = z.discriminatedUnion('type', [
  AgentHello,
  AgentService,
  AgentServiceGone,
  AgentStatus,
  AgentLog,
  AgentStats,
  AgentCommandResult,
]);
export type AgentMessage = z.infer<typeof AgentMessage>;

// --- Control plane -> agent (commands) -------------------------------------

/** Actions an operator can trigger. Allowlisted: no arbitrary execution. */
export const ActionKind = z.enum(['restart', 'redeploy']);
export type ActionKind = z.infer<typeof ActionKind>;

export const ServerCommand = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal('command'),
  id: z.string().max(128),
  action: ActionKind,
  serviceId: z.string().max(256),
  containerId: z.string().max(128),
});
export type ServerCommand = z.infer<typeof ServerCommand>;

// --- Browser -> control plane ----------------------------------------------

export const ClientSubscribe = z.object({
  type: z.literal('subscribe'),
  serviceId: z.string(),
});

export const ClientUnsubscribe = z.object({
  type: z.literal('unsubscribe'),
  serviceId: z.string(),
});

export const ClientAction = z.object({
  type: z.literal('action'),
  action: ActionKind,
  serviceId: z.string().min(1).max(256),
});

export const ClientMessage = z.discriminatedUnion('type', [
  ClientSubscribe,
  ClientUnsubscribe,
  ClientAction,
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// --- Control plane -> browser ----------------------------------------------

export const ServerServices = z.object({
  type: z.literal('services'),
  services: z.array(ServiceInfo),
});

export const ServerSnapshot = z.object({
  type: z.literal('snapshot'),
  serviceId: z.string(),
  logs: z.array(LogLine),
});

export const ServerLog = z.object({
  type: z.literal('log'),
  log: LogLine,
});

export const ServerStatus = z.object({
  type: z.literal('status'),
  serviceId: z.string(),
  state: ServiceState,
  exitCode: z.number().int().optional(),
  ts: z.number().int(),
});

export const ServerStats = z.object({
  type: z.literal('stats'),
  stats: Stats,
});

export const ServerActionResult = z.object({
  type: z.literal('action_result'),
  serviceId: z.string(),
  action: ActionKind,
  ok: z.boolean(),
  error: z.string().optional(),
});

export const ServerDeploy = z.object({
  type: z.literal('deploy'),
  serviceId: z.string(),
  deploy: DeployRecord,
});

export const ServerMessage = z.discriminatedUnion('type', [
  ServerServices,
  ServerSnapshot,
  ServerLog,
  ServerStatus,
  ServerStats,
  ServerActionResult,
  ServerDeploy,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** Parse an untrusted JSON string into a typed AgentMessage, or throw. */
export function parseAgentMessage(raw: string): AgentMessage {
  return AgentMessage.parse(JSON.parse(raw));
}

/** Parse an untrusted JSON string into a typed ClientMessage, or throw. */
export function parseClientMessage(raw: string): ClientMessage {
  return ClientMessage.parse(JSON.parse(raw));
}
