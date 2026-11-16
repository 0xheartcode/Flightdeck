# Architecture

Flightdeck is three parts talking over one versioned protocol.

## Components

### Agent (`agent/`, Rust)

One static binary per server. Responsibilities:

1. Connect to the Docker or Podman socket (bollard, Docker-compatible API).
2. Every `FD_SCAN_INTERVAL` seconds, list containers labelled
   `flightdeck.enable=true`. The service id comes from the optional
   `flightdeck.service` label, else the container name.
3. For each new container, spawn a task that follows its logs and forwards
   each line to the control plane. Reap tasks when a container disappears.
4. Maintain one WebSocket connection to the control plane, sending a `hello`
   on connect and reconnecting with backoff on drop.

The agent also executes allowlisted commands sent by the control plane
(`restart`, and `redeploy` which re-pulls the image and recreates the
container with the same config), reporting the result. Anything not on the
allowlist is rejected; there is no arbitrary execution.

`FD_RUNTIME` selects the backend. The default `docker` is the flow above. With
`systemd` (see agent/src/systemd.rs), the agent instead tracks the units in
`FD_SYSTEMD_UNITS` via `systemctl`/`journalctl`: it reports their state,
streams their journal as logs, and restarts them (redeploy and env editing do
not apply to units). The Docker and systemd loops are kept separate so the
container path is untouched; Kubernetes would be a third runtime.

### Control plane (`apps/control-plane/`, TypeScript)

- **HTTP (Hono)**: `GET /api/health`, `GET /api/services`,
  `GET /api/services/:id` (service + recent log tail + latest deploy + env,
  masked unless revealed), `GET /api/me` (caller identity and permissions),
  `GET /api/audit` (action trail), `GET /api/deploys`, `GET /metrics`
  (Prometheus, unauthenticated, counts only), and `POST /github/webhook`
  (HMAC-authenticated GitHub Actions ingestion). The `/api` surface is gated by
  the dashboard token or, when identity is on, a verified JWT.
- **Identity and RBAC**: optional. A configured HS256/RS256 key turns on JWT
  verification (`identity.ts`, node:crypto only, no JWKS fetch); roles map to
  permissions (view, act, reveal), the audit log records the user, and the
  single dashboard token is the fallback when identity is off.
- **WS `/agent`**: token-authenticated. Agents push `service`, `status`,
  `log`, and `service_gone` messages, applied to the store.
- **WS `/stream`**: browsers connect (JWT in `?token=` when identity is on),
  receive the live service list, and on `subscribe` get a snapshot of the recent
  tail then a live stream. An `action` message (e.g. restart) is routed to the
  agent owning that service and the result returned to the browser; it requires
  the act permission and is off unless `FD_ENABLE_ACTIONS=true`.
- **Store**: in-memory service registry plus a bounded ring buffer of recent
  logs per service (`FD_LOG_BUFFER_SIZE`). Env vars are held in a separate map,
  kept out of the registry and the stream so raw secret values are never
  broadcast. The ring is the live view and is deliberately not durable; when
  `FD_LOKI_URL` is set, every line is also shipped to Loki (batched) for durable
  storage and search via `GET /api/services/:id/logs/search` (LogQL range
  queries). See loki.ts.

### Web (`apps/web/`, React)

Services list on the left, a live auto-scrolling log viewer on the right. The
service list is polled over REST; logs stream over a dedicated WebSocket.

### Protocol (`packages/protocol/`)

The single source of truth for the wire format, as zod schemas with inferred
TypeScript types. The agent mirrors the same shapes with serde structs. The
protocol is versioned (`v: 1`); every message carries it.

## Data flow

```
container stdout/stderr
   -> agent (docker.logs follow)
   -> WS /agent  (AgentMessage: log)
   -> control plane store (ring buffer + fan-out)
   -> WS /stream (ServerMessage: snapshot, then log)
   -> web log viewer
```

## Deploy correlation

GitHub Actions posts `workflow_run` events to `POST /github/webhook`. The
control plane verifies the HMAC signature (`FD_GITHUB_WEBHOOK_SECRET`), maps the
event to a deploy record (repo, sha, branch, status, run URL, actor), and
persists it in SQLite (`DeployStore`, file via `FD_DB_FILE`, in-memory by
default). A deploy is correlated to a service by the operator-provided
`flightdeck.repo` label (and optional `flightdeck.environment`): matching
services get the deploy pushed to their subscribers, and a browser is sent the
latest deploy for a service the moment it subscribes. `DeployStore` is a small
async interface with two backends: SQLite (`SqliteDeployStore`, default) and
Postgres (`PgDeployStore`, selected by `FD_DATABASE_URL`) for HA (see below).

## High availability

The deploy store is pluggable so the durable state can be shared. Set
`FD_DATABASE_URL` and the control plane uses Postgres instead of SQLite; run
several instances behind a load balancer, all pointed at the same database, and
they share deploy history and correlation (a webhook to one instance is visible
from another). Live state is shared too: a Postgres LISTEN/NOTIFY bus (`bus.ts`)
mirrors every live event (service list, status, logs, stats, deploys) between
instances and routes commands across them, so a browser on any instance sees the
whole fleet and can act on a service whose agent is connected to a different
instance. Each instance still holds its own agents' sockets; the bus carries the
events, so no agent or browser needs to be pinned to a particular instance. (At
very large fleets, moving the high-volume log stream to per-service channels or a
dedicated bus would reduce cross-instance chatter.) A single instance uses a
no-op bus and is unaffected.

## Environment surfacing

With `FD_COLLECT_ENV` on, the agent inspects each labelled container once
(caching by container id, since env is immutable for a container's lifetime)
and reports its env vars to the control plane. The control plane strips env from
the registry it broadcasts, holds it in a separate map, and serves it only at
`GET /api/services/:id` with values masked. A caller with the reveal permission
(an admin role, or any caller in legacy single-token mode) sees raw values; keys
are always visible. Values are never logged. An admin can also edit env: a
`set_env` command recreates the container with the new environment (the redeploy
recreate path, without an image re-pull), gated on the reveal permission and on
actions being enabled, and audited.

## Roadmap

The core is feature complete (see CHANGELOG.md). Natural next steps as usage
demands them: moving the high-volume HA log stream to per-service channels or a
dedicated bus at large scale, and additional agent runtimes.
