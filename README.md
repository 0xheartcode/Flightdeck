# Flightdeck-CD 🛫

A lightweight, self-hosted deployment control plane for containers on your own servers. Railway-style ergonomics, your hardware.

> **Status:** v0.1.0. The spine works end to end: a Rust agent discovers labelled containers on a host, streams their console logs over WebSocket to the control plane, and a React UI shows services and live logs. Deploy correlation from GitHub Actions, env surfacing, and restart/redeploy are on the roadmap.

## Why this exists

The open-source field for deployment visibility splits into two camps. Analytics platforms like Apache DevLake aggregate DORA metrics over weeks but never touch runtime logs. GitHub's own deployment view stops at the CI boundary and is GitHub-only. Heavyweight portals like Backstage take months to stand up.

None of them answer the simple, developer-facing question: **"what is running on my servers right now, what is it logging, and did my last deploy actually go out?"** Flightdeck-CD is that single pane of glass, and you host it yourself.

It talks to the **Docker-compatible API**, so the same agent runs against Docker or a rootless Podman socket unchanged.

## Architecture

```
  server A                     server B                   GitHub (roadmap)
  ┌─────────────┐              ┌─────────────┐             (Actions webhooks:
  │ fd agent    │              │ fd agent    │              deploy correlation)
  │ (Rust,      │              │ (Rust,      │
  │  socket)    │              │  socket)    │
  └──────┬──────┘              └──────┬──────┘
         │  logs / status / services  │
         └──────────────┬─────────────┘
                        ▼
              ┌──────────────────────┐
              │   control plane       │
              │  Hono + WS + store    │   (TypeScript, Node 24)
              └──────────┬────────────┘
                         ▼
                   web UI (React 19)
          services list -> live log viewer
```

- **agent** (Rust): one small static binary per host. Discovers containers labelled `flightdeck.enable=true`, follows their logs via the bollard Docker API client, and forwards them to the control plane. Reconnects automatically.
- **control plane** (`@flightdeck/control-plane`, TypeScript): a Hono HTTP API plus two WebSocket endpoints, one for agents and one for browsers. Keeps a bounded in-memory log tail per service and fans live events out to the UI.
- **web** (`@flightdeck/web`, React 19 + Vite + Tailwind): services list and a live, auto-scrolling log viewer.
- **`@flightdeck/protocol`**: the shared, versioned wire contract (zod schemas on the TypeScript side, mirrored serde structs in the agent).

## Quick start

Prerequisites: Node 24+, pnpm (via corepack), Rust stable, and a reachable Docker or Podman socket. Run `just doctor` to check.

```bash
corepack enable
pnpm install
cp .env.example .env        # set FD_AGENT_TOKEN to a strong value

# terminal 1: control plane + web UI
pnpm dev

# terminal 2: the agent, against the local socket
just agent --hostname "$(hostname)"
```

Then label any container so the agent picks it up:

```bash
docker run -d --label flightdeck.enable=true --label flightdeck.service=my-api my-image
```

Open the web UI (Vite prints the URL, default http://localhost:5173), select the service, and watch its logs stream live.

## Repo layout

```
apps/
  control-plane/   TypeScript control plane (Hono + WebSocket + in-memory store)
  web/             React 19 + Vite + Tailwind UI
packages/
  protocol/        @flightdeck/protocol - shared wire contract (zod + types)
agent/             Rust per-server agent (cargo workspace member)
docker/            Dockerfiles + compose
docs/              architecture and security notes
```

## The gate

One command runs the whole quality gate across both stacks, and CI runs exactly it. Commit only when it is green.

```bash
just check          # pnpm check (format, lint, typecheck, test, build) + cargo fmt/clippy/test
```

## Security

The agent needs the Docker or Podman socket. On Docker that socket is root-equivalent, so prefer a **rootless Podman** socket in production, authenticate the agent to the control plane with a strong `FD_AGENT_TOKEN`, and keep the agent command-scoped. See [docs/security.md](docs/security.md).

## Roadmap

See [docs/architecture.md](docs/architecture.md) for the full picture. Next up: resource stats, restart/redeploy actions, GitHub Actions deploy correlation, and read-only env surfacing.

## License

MIT. See [LICENSE](LICENSE).
