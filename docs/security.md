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
- Each agent can have its own credential. Configure a set of `name:token`
  pairs (via `FD_AGENT_TOKENS_FILE`, `FD_AGENT_TOKENS`, or a single
  `FD_AGENT_TOKEN`); a presented token resolves to a named identity, and tokens
  are compared in constant time. To revoke one agent, remove its line from the
  file: the control plane reloads credentials periodically, rejects the token
  on reconnect, and drops the live connection whose credential was removed.
- A connection may only report for services it announced, and only for its own
  host, so one credential cannot spoof or clobber another host's services, and
  a service is removed when the agent that announced it disconnects.

## Browser to control plane

- The REST API and the `/stream` WebSocket are gated by `FD_DASHBOARD_TOKEN`
  when it is set; when unset they are unauthenticated, so set it for anything
  beyond a trusted network. The web UI sends it via `VITE_FD_DASHBOARD_TOKEN`
  (baked into the bundle: this gates casual and cross-origin access, not a
  determined local user).
- CORS is restricted to `FD_CORS_ORIGIN` (not `*` by default), and the
  `/stream` WebSocket upgrade validates the `Origin` header against it, since
  WebSockets otherwise bypass CORS entirely.

### Identity and roles

- For per-user access instead of one shared token, configure identity: the
  control plane verifies a JWT bearer (any OIDC provider that issues JWTs) with
  a configured HS256 secret, a static RS256 public key, or an OIDC JWKS endpoint
  (`FD_OIDC_*`). Setting any of these turns identity on and the dashboard token
  no longer applies. The signature (HS256 or RS256), `exp`/`nbf` (with small
  leeway), and `iss`/`aud` when configured are all checked, and the `none`
  algorithm is rejected. With `FD_OIDC_JWKS_URI`, the provider's RS256 keys are
  fetched and refreshed in the background and matched to a token by its `kid`,
  so rotating keys work; verification itself stays synchronous, reading an
  in-memory key cache rather than fetching per request.
- Browser login (optional): configure `FD_OIDC_CLIENT_ID`, the provider's
  authorization and token endpoints, a redirect URI, and `FD_SESSION_SECRET` to
  turn on the authorization-code + PKCE flow. `/auth/login` sends the browser to
  the provider with a signed state cookie carrying the PKCE verifier;
  `/auth/callback` checks the state, exchanges the code at the token endpoint,
  verifies the returned id_token (same checks as above), and stores it in an
  HttpOnly, SameSite=Lax session cookie (Secure when the redirect URI is https).
  `/api` and `/stream` accept that cookie as well as a bearer token. The session
  is the provider's own JWT, so it self-expires; `/auth/logout` clears it. Serve
  the UI and control plane on one origin (see the deploy guide) so the cookie is
  sent.
- Roles (read from `FD_OIDC_ROLES_CLAIM`, a dotted path is allowed) map to
  permissions: a role in `FD_OPERATOR_ROLES` may trigger actions, a role in
  `FD_ADMIN_ROLES` may additionally reveal env values, and every authenticated
  user may view. With no roles configured, any authenticated user is a trusted
  operator. The browser cannot set WebSocket headers, so the stream token rides
  the `?token=` query; treat it like any bearer token and run behind TLS.

## Operator actions

- Actions that change a container (`restart`, and `redeploy` which recreates it
  from a freshly pulled image) are **off by default** and only enabled with
  `FD_ENABLE_ACTIONS=true`. The agent executes an allowlist of actions and
  rejects anything else, so there is no arbitrary command execution through the
  agent. Redeploy renames the old container aside and restores it if the new
  one fails to start.
- When actions are enabled, authenticate the browser surface so only trusted
  callers can trigger them: set `FD_DASHBOARD_TOKEN`, or enable identity and put
  the acting roles in `FD_OPERATOR_ROLES` (the control plane warns if actions
  are on without any authentication). With identity on, a caller lacking an
  operator role is refused and the refusal is audited. An action is routed only
  to the agent that owns the target service.
- Every action is recorded to an audit trail (who/what/when/outcome): to the
  structured log, to `/api/audit`, and, if `FD_AUDIT_LOG_FILE` is set, appended
  as JSONL so it survives a restart.

## GitHub webhook

- `POST /github/webhook` is authenticated by the GitHub `X-Hub-Signature-256`
  HMAC (verified in constant time against `FD_GITHUB_WEBHOOK_SECRET`), not the
  dashboard token. The endpoint is disabled (404) when no secret is set.

## Metrics

- Prometheus metrics are served at `/metrics` without authentication. They
  expose counts only (connected agents, services, log lines, action totals),
  no secrets. Restrict the endpoint at the network layer if needed.

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
  before exposing it. When `FD_LOKI_URL` is set, those lines are also shipped to
  Loki: secure that Loki instance and the network path to it, and set
  `FD_LOKI_TENANT` for a multi-tenant deployment. The search API is gated by the
  same `/api` authentication as everything else.
- Flightdeck-CD does not persist application secrets. Environment surfacing is
  off by default (`FD_COLLECT_ENV`); when on, the agent reports each container's
  env to the control plane over the authenticated agent link. The control plane
  keeps env out of the broadcast registry and the stream entirely, holds it only
  in memory, and serves it at `GET /api/services/:id` with values masked. Only a
  caller with the reveal permission (an admin role, or any caller in legacy
  single-token mode) sees raw values; keys are always visible. Editing env is
  gated on that same reveal permission and on actions being enabled: it sends a
  `set_env` command and the agent recreates the container with the new
  environment (the same safe recreate path as redeploy), and the edit is
  audited. Flightdeck keeps no secrets store of its own.

## Reporting

Report suspected vulnerabilities privately; see SECURITY.md.
