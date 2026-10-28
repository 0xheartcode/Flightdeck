# Architecture

Flightdeck-CD is three parts talking over one versioned protocol.

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

The agent only reads today. Command execution (restart, redeploy) is a planned
addition and will be strictly allowlisted.

### Control plane (`apps/control-plane/`, TypeScript)

- **HTTP (Hono)**: `GET /api/health`, `GET /api/services`,
  `GET /api/services/:id` (service + recent log tail).
- **WS `/agent`**: token-authenticated. Agents push `service`, `status`,
  `log`, and `service_gone` messages, applied to the store.
- **WS `/stream`**: browsers connect, receive the live service list, and on
  `subscribe` get a snapshot of the recent tail then a live stream.
- **Store**: in-memory service registry plus a bounded ring buffer of recent
  logs per service (`FD_LOG_BUFFER_SIZE`). Deliberately not durable; long-term
  log storage is a later concern (ship to Loki).

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

## Roadmap

- **Actions**: restart and redeploy, sent control-plane -> agent over the
  existing socket, strictly allowlisted (no arbitrary exec).
- **Deploy correlation**: ingest GitHub Actions webhooks and link a workflow
  run / image tag to the service it deployed, producing a deploy timeline.
- **Env surfacing**: show the env var names a container runs with, values
  reveal-gated and audited. Editing (later) goes through the deploy path, not
  a secrets store of our own.
- **Multi-runtime**: systemd and Kubernetes beyond Docker/Podman.
- **Durable logs**: optional shipping to Loki for search and retention.
