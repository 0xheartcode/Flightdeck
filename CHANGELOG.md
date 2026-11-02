# Changelog

All notable changes to this project are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Multi-runtime agent (systemd): the agent now selects a runtime via
  `FD_RUNTIME` ("docker", the default, or "systemd"). The systemd backend tracks
  the units listed in `FD_SYSTEMD_UNITS` through `systemctl`/`journalctl`: it
  discovers their state, streams their journal as logs, and restarts them
  (redeploy and env editing do not apply to units). The Docker/Podman path is
  unchanged. Kubernetes is a further runtime.
- Browser end-to-end smoke test (Playwright): a harness (`just e2e`) that builds
  both apps, boots the control plane with a fake agent, serves the web bundle,
  and drives a real browser to assert the dashboard loads, lists the service,
  and streams its logs. Runs as a main-only CI job; kept out of the fast gate.
- HA foundation (Postgres-backed shared state): the deploy store is now a
  pluggable async interface with a SQLite backend (single instance, the default)
  and a Postgres backend selected by `FD_DATABASE_URL`. With Postgres, multiple
  control-plane instances behind a load balancer share durable deploy state (a
  webhook to one instance is visible from another). Note the in-memory service
  registry and live log streaming remain per-instance; a cross-instance bus for
  live fan-out is the next HA step. Adds the `pg` dependency.
- Durable log search (Loki): set `FD_LOKI_URL` and the control plane ships every
  log line to Loki (batched) in addition to the in-memory tail, and
  `GET /api/services/:id/logs/search?q=&from=&to=` runs a LogQL range query so
  history is searchable across time (the UI gains a search box). The in-memory
  ring stays the live view; Loki is the durable, searchable archive. Uses only
  fetch, no new dependency.
- OIDC browser login: an authorization-code + PKCE flow so users sign in with
  the identity provider instead of pasting a JWT. `/auth/login` redirects to the
  provider, `/auth/callback` exchanges the code and stores the provider's
  id_token in an HttpOnly session cookie, and `/api` and `/stream` accept that
  cookie. Enabled by `FD_OIDC_CLIENT_ID` + endpoints + `FD_SESSION_SECRET`; the
  token is still verified with the configured keys/JWKS. The UI shows a Sign in
  button. Uses only node:crypto and fetch (no new dependency).
- Multi-arch agent image: `docker/Dockerfile.agent` now builds for both
  `linux/amd64` and `linux/arm64`. The Rust binary is cross-compiled on the
  native build host (fast, no emulation; `ring` cross-compiles cleanly) and CI
  validates both architectures, so the agent runs on ARM servers.
- Environment variable editing: an admin (the reveal permission) can edit a
  service's env from the UI. The control plane sends a `set_env` command and the
  agent recreates the container with the new environment (no image re-pull),
  the same safe recreate path as redeploy (old container renamed aside, rolled
  back on failure). The edit is audited and requires actions to be enabled.
- OIDC JWKS support: set `FD_OIDC_JWKS_URI` and the control plane fetches and
  refreshes the provider's RS256 signing keys in the background, matching each
  token to a key by its `kid`. This makes identity work with providers that
  rotate keys (Auth0, Keycloak, Google), alongside the existing static HS256
  secret and RS256 public key. Verification stays synchronous (it reads an
  in-memory key cache, never a per-request fetch).
- Production deployment path: `docker/compose.prod.yaml` (control plane + web
  only, bound to localhost for a TLS reverse proxy, with a persistent `/data`
  volume for the deploy store and audit trail and a readiness healthcheck), a
  systemd unit and env template (`deploy/`) for running the agent as a non-root
  binary against a rootless Podman socket, and a production guide
  (`docs/deploy.md`).
- Health probes: unauthenticated `GET /healthz` (liveness) and `GET /readyz`
  (readiness, which checks the deploy store). Container healthchecks now use
  these, so they keep working once the browser surface requires auth (the old
  `/api/health` sits behind the auth gate).

- Identity and access control: the control plane can verify a JWT bearer token
  (any OIDC provider that issues JWTs) on the browser stream and REST API, using
  a configured HS256 secret or RS256 public key (`FD_OIDC_*`). Verification is
  local (no JWKS fetch). Roles map to permissions: `FD_OPERATOR_ROLES` gate
  actions, `FD_ADMIN_ROLES` gate revealing env values, and the audit log records
  the authenticated user. Identity is off unless a key is set, so the existing
  single dashboard token keeps working unchanged. The web UI gains a sign-in
  field and hides controls a user's role does not allow.
- Read-only environment variables per service: the agent can collect each
  container's env (`FD_COLLECT_ENV`, off by default since values are secrets)
  and report it to the control plane, which keeps it out of the broadcast
  registry and the stream, serves it masked at `GET /api/services/:id`, and
  unmasks it only for a caller with the reveal (admin) permission. The UI shows
  an environment panel. `GET /api/me` reports the caller's identity and perms.
- GitHub Actions deploy correlation: a signed `POST /github/webhook` ingests
  `workflow_run` events, persists them in SQLite (`DeployStore`, `FD_DB_FILE`),
  and correlates each to services by the `flightdeck.repo` label. Matching
  services get the deploy pushed live, the UI shows a deploy status badge, and
  `GET /api/deploys` serves the history.

- Action audit trail: every operator action is recorded (who/what/when/outcome)
  to the structured log and `/api/audit`, and optionally appended as JSONL
  (`FD_AUDIT_LOG_FILE`) so it survives a restart.
- Prometheus metrics at `/metrics` (connected agents, services, log lines,
  action totals).
- Integration test that starts the control plane with a fake agent and browser
  client and asserts the full flow (log streaming and a routed action).
- CI: supply-chain audit with cargo-deny (`deny.toml` + `just audit`) and a
  Docker build-validation job; a Dependabot config for npm and GitHub Actions.

- Restart action: restart a container from the UI. The control plane routes an
  allowlisted command to the agent that owns the service and reports the
  result. Off by default; enable with `FD_ENABLE_ACTIONS=true`.
- Redeploy action: re-pull the service's image and recreate the container with
  the same configuration. The old container is renamed aside and restored if
  the new one fails to start. Same allowlist and opt-in gate as restart.

- Agent now collects and streams CPU and memory usage per container, shown in
  the log view header.
- Container exit codes are surfaced for stopped services.

### Changed

- Service ids are namespaced by host and disambiguated when the same service
  label is used more than once, so services no longer collapse or interleave.
- Agent reconnects with exponential backoff plus jitter and sends periodic
  heartbeats; the agent image runs as a non-root user by default.

### Security

- Rate limiting: a cap on concurrent WebSocket connections
  (`FD_MAX_CONNECTIONS`) and on operator actions per browser per minute
  (`FD_ACTION_RATE_PER_MIN`), checked before anything else so action spam cannot
  flood the audit log.
- Per-agent credentials: configure `name:token` pairs (file or inline) so each
  agent has its own token resolving to a named identity. Removing an agent's
  line revokes it: the control plane reloads credentials, rejects the token on
  reconnect, and drops the live connection. A single `FD_AGENT_TOKEN` still
  works for simple setups.
- A control-plane connection may only report for services it announced, and
  only for its own host, preventing cross-connection spoofing or clobbering.

### Fixed

- CORS now allows credentials only with a specific `FD_CORS_ORIGIN` (not `*`),
  so the web app's credentialed requests and the session cookie work
  cross-origin. The browser forbids combining credentials with a wildcard
  origin, which silently blocked the service list when the UI and control plane
  were on different origins. Caught by the new browser e2e test.

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
