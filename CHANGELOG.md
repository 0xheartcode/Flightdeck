# Changelog

All notable changes to this project are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Restart action: restart a container from the UI. The control plane routes an
  allowlisted command to the agent that owns the service and reports the
  result. Off by default; enable with `FD_ENABLE_ACTIONS=true`.

- Agent now collects and streams CPU and memory usage per container, shown in
  the log view header.
- Container exit codes are surfaced for stopped services.

### Changed

- Service ids are namespaced by host and disambiguated when the same service
  label is used more than once, so services no longer collapse or interleave.
- Agent reconnects with exponential backoff plus jitter and sends periodic
  heartbeats; the agent image runs as a non-root user by default.

### Security

- Per-agent credentials: configure `name:token` pairs (file or inline) so each
  agent has its own token resolving to a named identity. Removing an agent's
  line revokes it: the control plane reloads credentials, rejects the token on
  reconnect, and drops the live connection. A single `FD_AGENT_TOKEN` still
  works for simple setups.
- A control-plane connection may only report for services it announced, and
  only for its own host, preventing cross-connection spoofing or clobbering.

## [0.1.0] - 2026-10-28

Initial scaffold and working spine.

### Added

- Rust agent (`agent/`): discovers containers labelled `flightdeck.enable=true`
  on the local Docker/Podman socket, follows their logs, and streams logs,
  status, and service discovery to the control plane over WebSocket with
  automatic reconnect.
- Control plane (`@flightdeck/control-plane`): Hono HTTP API
  (`/api/health`, `/api/services`, `/api/services/:id`), token-authenticated
  `/agent` WebSocket, browser `/stream` WebSocket, and an in-memory store with
  a bounded per-service log ring buffer.
- Web UI (`@flightdeck/web`): React 19 + Vite + Tailwind services list and a
  live, auto-scrolling log viewer.
- Shared wire protocol (`@flightdeck/protocol`): versioned zod schemas and
  types, mirrored by serde structs in the agent.
- Tooling: pnpm + Turborepo workspace, cargo workspace, ESLint flat config,
  Prettier, Vitest, a single `just check` gate, and CI that runs it.
