# Changelog

All notable changes to this project are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
