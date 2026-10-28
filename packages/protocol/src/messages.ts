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
});
export type ServiceInfo = z.infer<typeof ServiceInfo>;

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

export const AgentMessage = z.discriminatedUnion('type', [
  AgentHello,
  AgentService,
  AgentServiceGone,
  AgentStatus,
  AgentLog,
  AgentStats,
]);
export type AgentMessage = z.infer<typeof AgentMessage>;

// --- Browser -> control plane ----------------------------------------------

export const ClientSubscribe = z.object({
  type: z.literal('subscribe'),
  serviceId: z.string(),
});

export const ClientUnsubscribe = z.object({
  type: z.literal('unsubscribe'),
  serviceId: z.string(),
});

export const ClientMessage = z.discriminatedUnion('type', [ClientSubscribe, ClientUnsubscribe]);
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

export const ServerMessage = z.discriminatedUnion('type', [
  ServerServices,
  ServerSnapshot,
  ServerLog,
  ServerStatus,
  ServerStats,
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
