# Production deployment

This is the hardened path for running Flightdeck-CD beyond a trusted network.
For a quick local demo instead, use `just demo` (see the README); that stack
mounts the root Docker socket and is not meant for production.

## Topology

- **Control plane + web UI**: two containers on one host, from
  `docker/compose.prod.yaml`. Ports bind to `127.0.0.1`; a TLS-terminating
  reverse proxy sits in front.
- **Agent**: a static binary on each monitored host, run by systemd as a
  non-root user against a **rootless Podman** socket. It is never run as a
  container with the Docker socket mounted (that socket is root-equivalent; see
  [security.md](security.md)).

```
        browser ──TLS──> reverse proxy ──> web (static UI)        :8080
                                        └─> control plane         :4000
                                                  ▲ wss
        host A: flightdeck-agent (systemd) ───────┤
        host B: flightdeck-agent (systemd) ───────┘
```

## 1. Control plane and web UI

Pick one domain, say `flightdeck.example.com`. The browser, API, and both
WebSockets share it (same origin, so no CORS surprises).

Create `docker/.env` (never commit it):

```sh
# Agents authenticate with this (give each host its own via FD_AGENT_TOKENS_FILE
# for individual revocation; a single token is the simplest start).
FD_AGENT_TOKEN=$(openssl rand -hex 32)

# The browser origin and the public API URL (same origin here).
FD_CORS_ORIGIN=https://flightdeck.example.com
FD_PUBLIC_API_URL=https://flightdeck.example.com

# Authenticate the browser. Either a shared dashboard token:
FD_DASHBOARD_TOKEN=$(openssl rand -hex 32)
# ...or per-user identity (see "Authentication" below), which supersedes it.

# Operator actions are disruptive; enable deliberately.
FD_ENABLE_ACTIONS=false
```

Bring it up:

```sh
docker compose -f docker/compose.prod.yaml --env-file docker/.env up -d --build
```

The control plane persists its deploy history and audit trail to a named volume
(`flightdeck-data`, mounted at `/data`), so they survive restarts.

### Reverse proxy

Route the API, both WebSockets, and the webhook to the control plane; everything
else to the web UI. A Caddyfile (Caddy gets you automatic TLS):

```
flightdeck.example.com {
  @cp path /api/* /stream /agent /github/webhook /metrics /healthz /readyz
  handle @cp {
    reverse_proxy 127.0.0.1:4000
  }
  handle {
    reverse_proxy 127.0.0.1:8080
  }
}
```

WebSocket upgrades (`/agent`, `/stream`) pass through `reverse_proxy` unchanged.

## 2. Agents (one per host)

Build the static binary (on a build host with the Rust toolchain, matching the
target architecture) and copy it to each monitored host:

```sh
cargo build --release -p flightdeck-agent
# -> target/release/flightdeck-agent
```

The agent Docker image (`docker/Dockerfile.agent`) builds for both
`linux/amd64` and `linux/arm64` if you prefer to run the agent as a container
or to cross-build for an ARM host:

```sh
docker buildx build --platform linux/amd64,linux/arm64 \
  -f docker/Dockerfile.agent -t flightdeck-agent:latest .
```

On each host:

```sh
sudo useradd --system --create-home --shell /usr/sbin/nologin flightdeck
sudo install -m 0755 target/release/flightdeck-agent /usr/local/bin/flightdeck-agent

# Rootless Podman socket owned by the flightdeck user:
sudo loginctl enable-linger flightdeck
sudo -u flightdeck XDG_RUNTIME_DIR=/run/user/$(id -u flightdeck) \
  systemctl --user enable --now podman.socket

sudo install -D -m 0600 deploy/agent.env.example /etc/flightdeck/agent.env
sudoedit /etc/flightdeck/agent.env   # set FD_CONTROL_PLANE_URL, FD_AGENT_TOKEN,
                                      # FD_DOCKER_HOST (the socket path), HOSTNAME

sudo install -m 0644 deploy/flightdeck-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now flightdeck-agent
sudo systemctl status flightdeck-agent
```

`FD_DOCKER_HOST` is `unix:///run/user/<uid>/podman/podman.sock` where `<uid>`
is `id -u flightdeck`. Label the containers you want tracked with
`flightdeck.enable=true` (and optionally `flightdeck.service`, `flightdeck.repo`,
`flightdeck.environment`).

## Authentication

Choose one for the browser surface (the agent always uses its own token):

- **Dashboard token** (simplest): set `FD_DASHBOARD_TOKEN`. Everyone who has it
  is a trusted operator.
- **Identity (OIDC/JWT)**: set `FD_OIDC_HS256_SECRET`, `FD_OIDC_RS256_PUBLIC_KEY`,
  or `FD_OIDC_JWKS_URI` to require a verified JWT, and map roles to permissions
  with `FD_OPERATOR_ROLES` (may act) and `FD_ADMIN_ROLES` (may reveal env
  values). The audit log then records the user. With a JWKS URI the provider's
  rotating keys are tracked automatically; with a static key, paste the
  provider's current signing key.
- **Browser login (recommended with identity)**: also set `FD_OIDC_CLIENT_ID`,
  `FD_OIDC_AUTH_ENDPOINT`, `FD_OIDC_TOKEN_ENDPOINT`, `FD_OIDC_REDIRECT_URI`
  (`https://flightdeck.example.com/auth/callback`), and `FD_SESSION_SECRET` so
  users click "Sign in" and authenticate with the provider instead of pasting a
  JWT. The session is an HttpOnly cookie, so the UI and control plane must share
  one origin (the single-domain reverse proxy above does this). See
  [security.md](security.md) for the full model.

## Operations

- **Health**: `GET /healthz` (liveness) and `GET /readyz` (readiness, checks the
  deploy store) are unauthenticated so probes work with auth on. The compose
  healthcheck uses `/readyz`.
- **Metrics**: `GET /metrics` (Prometheus, counts only, unauthenticated).
- **Backups**: back up the `flightdeck-data` volume (`/data/flightdeck.db` and
  `/data/audit.jsonl`).
- **Upgrades**: rebuild and recreate with
  `docker compose -f docker/compose.prod.yaml --env-file docker/.env up -d --build`;
  update agents by replacing the binary and `systemctl restart flightdeck-agent`.
- **Deploy correlation**: point a GitHub webhook at
  `https://flightdeck.example.com/github/webhook` with `FD_GITHUB_WEBHOOK_SECRET`.
