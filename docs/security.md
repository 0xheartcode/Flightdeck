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

- The agent authenticates with a shared bearer token (`FD_AGENT_TOKEN`).
  Generate a strong value (`openssl rand -hex 32`). An empty token rejects all
  agent connections.
- In production, terminate the control plane behind TLS and use `wss://`.
- The token is a shared secret for now. Per-agent credentials and mTLS are a
  planned hardening.

## Logs and secrets

- Logs can contain secrets that applications print. Treat the log tail and the
  log stream as sensitive, and put the control plane behind authentication
  before exposing it.
- Flightdeck-CD does not store application secrets. Planned env surfacing shows
  variable names with values reveal-gated and audited; editing (later) will go
  through the deploy path, never a secrets store of our own.

## Reporting

Report suspected vulnerabilities privately; see SECURITY.md.
