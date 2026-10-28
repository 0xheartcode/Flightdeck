# Security notes

The agent is the sensitive component: it holds access to the container runtime
socket on every host it runs on. Design accordingly.

## The socket is privileged

On **Docker**, the daemon runs as root and anything able to talk to
`docker.sock` is effectively root on the host (it can mount the filesystem,
run privileged containers, and so on). An agent compromise is therefore a host
compromise.

Mitigations, strongest first:

1. **Prefer a rootless Podman socket.** Podman is daemonless and rootless by
   default; its user socket controls only that user's containers, so a
   compromise is not host root. The agent speaks the Docker-compatible API, so
   it runs against Podman unchanged. Point `FD_DOCKER_HOST` at the rootless
   socket, for example `unix:///run/user/1000/podman/podman.sock`.
2. **Rootless Docker**, if you must stay on Docker.
3. **A socket proxy** that allowlists only the API calls the agent needs
   (list, inspect, logs, stats) in front of a standard Docker socket.

## Agent to control plane

- The agent authenticates with a shared bearer token (`FD_AGENT_TOKEN`),
  sent in an `Authorization: Bearer` header (never in the URL). Generate a
  strong value (`openssl rand -hex 32`). An empty token rejects all agents,
  and the token is compared in constant time.
- The agent supports `wss://`, so terminate the control plane behind TLS in
  production and point `FD_CONTROL_PLANE_URL` at `wss://...`.
- The token is a shared secret for now, so any holder can report or remove any
  service id. Per-agent credentials and per-connection service ownership are a
  planned hardening; today the control plane does scope cleanup to the
  connection (a service is removed when the agent that announced it
  disconnects).

## Browser to control plane

- The REST API and the `/stream` WebSocket are gated by `FD_DASHBOARD_TOKEN`
  when it is set; when unset they are unauthenticated, so set it for anything
  beyond a trusted network. The web UI sends it via `VITE_FD_DASHBOARD_TOKEN`
  (baked into the bundle: this gates casual and cross-origin access, not a
  determined local user).
- CORS is restricted to `FD_CORS_ORIGIN` (not `*` by default), and the
  `/stream` WebSocket upgrade validates the `Origin` header against it, since
  WebSockets otherwise bypass CORS entirely.

## Denial of service

- Both WebSocket servers cap frame size (`FD_MAX_PAYLOAD_BYTES`), the service
  registry is capped (`FD_MAX_SERVICES`), each browser socket is limited in how
  many services it may subscribe to, and a slow consumer has live frames
  dropped rather than buffered without bound. The agent caps each log line and
  uses a bounded outbound queue so a control-plane outage cannot exhaust its
  memory.

## Logs and secrets

- Logs can contain secrets that applications print. Treat the log tail and the
  log stream as sensitive, and put the control plane behind authentication
  before exposing it.
- Flightdeck-CD does not store application secrets. Planned env surfacing shows
  variable names with values reveal-gated and audited; editing (later) will go
  through the deploy path, never a secrets store of our own.

## Reporting

Report suspected vulnerabilities privately; see SECURITY.md.
