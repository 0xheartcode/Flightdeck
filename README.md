# Flightdeck-CD 🛫

A lightweight, self-hosted deployment control plane for containers on your own servers. Railway-style ergonomics, your hardware.

> **Status:** v0.1.0. The spine works end to end: a Rust agent discovers labelled containers on a host, streams their console logs, CPU/memory, and status (including exit codes) over WebSocket to the control plane, and a React UI shows services with live logs and resource usage. Operators can restart or redeploy a container from the UI (opt-in). GitHub Actions deploy correlation, per-user identity (OIDC/JWT) with role-based access, and env surfacing (masked, reveal-gated, with admin editing that recreates the container) are implemented.

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

Fastest, everything in containers (control plane, web UI, agent, and a sample service):

```bash
echo "FD_AGENT_TOKEN=$(openssl rand -hex 32)" > .env
just demo            # docker compose up --build
# open http://localhost:8080
```

Or run it from source for development:

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

## Web UI

The React UI (`apps/web`) is built from the Claude design in
[`docs/design/`](docs/design/) and ships light and dark themes. It is organised
as a routed shell (sidebar + command palette + global status banners) over these
screens:

- **Overview** — every tracked service with status, host and repo.
- **Service detail** — live logs, CPU/memory, status, gated restart /
  redeploy / environment editing, and an **Exposure** tab (published ports as
  public vs localhost, Docker-network IPs, label-derived domains).
- **Hosts** and **Project** — services grouped by host and by repo/environment;
  Hosts also shows each host's public IP and what is publicly reachable on it.
- **Deploys** — the cross-service GitHub Actions timeline (`/api/deploys`).
- **Activity** — the read-only operator audit trail (`/api/audit`).
- **Transmitter** — a notifications hub (sources → routes → channels: Telegram,
  Discord, Slack, webhooks; email/SMTP pending) with an in-app signal feed and
  delivery log. The backend lives in `apps/control-plane/src/transmitter/`
  (store + dispatcher + SSRF-guarded senders), gated by `FD_TRANSMITTER` (default
  on); credentials are write-only and inbound webhook tokens are hashed and shown
  once. The wire contract is
  [`docs/design/TRANSMITTER-API.md`](docs/design/TRANSMITTER-API.md); when the
  backend is disabled the UI falls back to a mock with a "preview" banner.
- **Settings** — identity, roles and server feature flags, plus optional
  self-managed accounts: **Users** (local username/password login, roles
  viewer/operator/admin) and **Agents** (issue/rotate/revoke agent tokens). Both
  are admin-gated, audited, and off by default (`FD_LOCAL_USERS`,
  `FD_AGENT_TOKEN_STORE`); see [docs/security.md](docs/security.md).

Controls reflect the server-enforced permission model (`view` / `act` /
`reveal`) and the `FD_ENABLE_ACTIONS` switch: ungranted or disabled actions are
shown disabled with a reason, never as silent no-ops. The design-to-API mapping
for every screen is tracked in [`docs/design/COVERAGE.md`](docs/design/COVERAGE.md).

## The gate

One command runs the whole quality gate across both stacks, and CI runs exactly it. Commit only when it is green.

```bash
just check          # pnpm check (format, lint, typecheck, test, build) + cargo fmt/clippy/test
```

## Deploying

For production, run the control plane and web UI from `docker/compose.prod.yaml` (bound to localhost behind a TLS reverse proxy, with a persistent data volume) and run the agent on each host as a non-root systemd service against a rootless Podman socket. The full walkthrough, including a reverse-proxy example and the authentication options, is in [docs/deploy.md](docs/deploy.md). Liveness and readiness are at `/healthz` and `/readyz`.

## Security

The agent needs the Docker or Podman socket. On Docker that socket is root-equivalent, so prefer a **rootless Podman** socket in production. Agents authenticate with a bearer token (sent as a header, compared in constant time, `wss://` supported): use a single `FD_AGENT_TOKEN`, or give each agent its own credential via `FD_AGENT_TOKENS` / `FD_AGENT_TOKENS_FILE` so one can be revoked individually (the control plane reloads the file and drops the revoked connection). The browser API and log stream are gated by `FD_DASHBOARD_TOKEN` when set, or by per-user identity: set an OIDC key (`FD_OIDC_HS256_SECRET` or `FD_OIDC_RS256_PUBLIC_KEY`) to require a verified JWT, map roles to permissions (`FD_OPERATOR_ROLES`, `FD_ADMIN_ROLES`), and the audit log then records the user. For a standalone deployment with no external IdP, enable local accounts with `FD_LOCAL_USERS` (scrypt-hashed passwords, roles viewer/operator/admin, seeded via `FD_BOOTSTRAP_ADMIN`); agent credentials can likewise be issued, rotated and revoked from the UI with `FD_AGENT_TOKEN_STORE`. CORS is restricted to `FD_CORS_ORIGIN` (not `*`), and the `/stream` upgrade checks `Origin`. Both WebSocket servers cap frame size and the registry is bounded. See [docs/security.md](docs/security.md) for the full threat model and knobs.

## Roadmap

See [docs/architecture.md](docs/architecture.md) for the full picture. Next up: HA / multi-instance (a shared store behind the control plane), multi-runtime agents (systemd, Kubernetes), and durable log search (Loki).

## License

MIT. See [LICENSE](LICENSE).
