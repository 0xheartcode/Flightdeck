# Exposure & routing awareness — feature spec

**Status:** **Phase 1 built** (ports, Docker-network IPs, label-derived routes,
host public IP; agent → protocol → `/api/exposure` → UI). Phase 2 (host LAN IPs)
and Phase 3 (nginx/Caddy config reader) remain unbuilt and opt-in/out-of-scope.
Written before code (like [`TRANSMITTER-API.md`](TRANSMITTER-API.md)) so the
security boundary was agreed first.

## What this is

A **read-only** view of how each tracked service is reachable: which host ports
it publishes (and whether they face the public internet or only localhost), the
container's addresses on its Docker networks, the domain(s) it answers on, and
the host's own public IP. One screen answers *"what on this box is reachable,
from where, at what domain, on what port?"* — the thing you currently learn by
SSHing in and reading `docker ps` / the nginx config by hand.

It replaces a *lookup you do manually today*. It does **not** change anything on
the host.

## The security boundary (read this first)

Flightdeck's credibility rests on the agent executing an **allowlist of safe
actions** and never arbitrary host commands, so an agent compromise is not
instant host-root. This feature must not erode that. Therefore:

- **Everything is derived from data the agent already reads** — the Docker
  `list_containers` summary, `inspect_container`, and container labels — plus
  one connection fact the control plane already has. No new privilege for the
  bulk of it.
- **No writing.** Nothing here edits proxy config, reloads a service, or mutates
  the host. It is strictly observe.
- **No host OS port scan.** We report *ports a container publishes* (Docker's own
  metadata), never "every port open on the operating system" (that needs
  `ss`/`netstat`/`ufw` on the host — a different tool, and exactly the broad
  access the threat model refuses).
- **No config-file parsing in core.** nginx/Caddy keep routing in files; reading
  them means giving the agent file access. Out of scope for core (see Non-goals).
  Routing comes from **labels** (Traefik, or a native `flightdeck.domain`), which
  the agent already reads.
- **One explicit, opt-in widening only:** reading the host's own network
  interfaces for its LAN IP(s). Off by default, behind its own flag, documented
  as a (small, read-only) access widening.

If a reviewer opens the agent and sees it reading interface lists or config
files unguarded, the project's security story breaks. This spec keeps that from
happening.

## Data sources — what is free vs what costs access

| Datum | Source | New access? |
| --- | --- | --- |
| Published ports (host port, protocol, bind IP) | Docker `list_containers` → `Ports[]` | **No** — already fetched |
| Public vs localhost-only | Derived: bind IP `0.0.0.0`/`::` = public, `127.0.0.1`/`::1` = local | **No** |
| Container IP on each Docker network | `inspect_container` → `NetworkSettings.Networks[].IPAddress` | **No** — already fetched |
| Domain → service (Traefik) | Container label `traefik.http.routers.<r>.rule=Host(...)` | **No** — labels already read |
| Domain → service (native) | Container label `flightdeck.domain=app.example.com` | **No** |
| Host **public** IP | Control-plane reads the agent socket's remote address at connect | **No** — connection fact |
| Host **LAN** IP(s) | Agent reads OS network interfaces | **Yes** — opt-in, `FD_COLLECT_HOST_IPS` |

The agent never self-reports its public IP (don't trust a host for its own
external address); the control plane observes it from the connection. Behind a
reverse proxy, the control plane uses a forwarded header **only if** an operator
has configured a trusted proxy (same rule as any `X-Forwarded-For` handling).

## Wire protocol additions (`packages/protocol/src/messages.ts`)

Extend `ServiceInfo` with two optional, bounded fields:

```ts
/** A port the container publishes to the host. */
export const PortMapping = z.object({
  containerPort: z.number().int(),
  protocol: z.enum(['tcp', 'udp']),
  /** Absent when the port is exposed but not published to the host. */
  hostPort: z.number().int().optional(),
  /** Host bind address: 0.0.0.0/:: = public, 127.0.0.1/::1 = localhost-only. */
  hostIp: z.string().max(45).optional(),
  /** Derived: published AND not bound to loopback. */
  public: z.boolean(),
});

/** The container's address on one Docker network. */
export const NetworkAttachment = z.object({
  network: z.string().max(256),
  ipAddress: z.string().max(45).optional(),
});

/** A domain the service answers on, learned from labels (never from files). */
export const RouteHint = z.object({
  domain: z.string().max(253),
  source: z.enum(['traefik-label', 'flightdeck-label']),
  tls: z.boolean().optional(),
});
```

`ServiceInfo` gains: `ports?: PortMapping[]`, `networks?: NetworkAttachment[]`,
`routes?: RouteHint[]` — all optional and capped (e.g. `.max(64)`), so an agent
that doesn't collect them, or an older agent, is still valid.

The agent `Announce` message gains an optional `lanIps?: string[]` (only when
`FD_COLLECT_HOST_IPS`). Public IP is **not** on the wire — the control plane sets
it from the socket.

## Control-plane API additions

- `GET /api/services/:id` already returns the service; include its `ports`,
  `networks`, and `routes`.
- Host derivation (today services are grouped by `host`) gains per-host
  `publicIp` and optional `lanIps`. Expose as a dedicated, gated read:

```
GET /api/exposure
→ {
    hosts: [{
      host: string,
      agentId: string,
      publicIp?: string,
      lanIps?: string[],
      services: [{
        id, name,
        ports:    PortMapping[],
        networks: NetworkAttachment[],
        routes:   RouteHint[],
      }],
    }],
  }
```

**Permissions:** this is `view`-level data (ports and domains are not secrets),
so it rides the same `/api` authentication as everything else — no `reveal`
needed. It is still attack-surface information, so it is never served
unauthenticated.

## Web UI

A derived **Exposure** view (fits the existing shell; no new design assets):

- **Per service** (on Service detail): an "Exposure" panel — published ports with
  a clear **Public / Localhost** pill each, the domain(s) it answers on, and its
  Docker-network IPs.
- **Per host** (Hosts screen): the host's public IP (and LAN IPs if collected),
  and a compact table of *what is publicly reachable on this box* — the one-glance
  answer. Ports bound to loopback are visually de-emphasised as not internet-facing.

Empty/!collected states follow the existing pattern (a service with no published
ports shows "not published", not a blank).

## Config flags

| Flag | Default | Effect |
| --- | --- | --- |
| *(ports / networks / route labels)* | **on** | No new access — part of normal service reporting. |
| *(host public IP)* | **on** | Control-plane side; no agent access. |
| `FD_COLLECT_HOST_IPS` | **off** | Agent reads OS interfaces for LAN IP(s). The one opt-in widening. |
| `FD_TRUSTED_PROXY` *(if not already present)* | **off** | Lets the control plane trust a forwarded header for the agent/public IP. |

## Non-goals (explicit)

- **No editing or reloading** nginx/Caddy/Apache or any service.
- **No host OS port scan** — only ports a container publishes.
- **No parsing nginx/Caddy config files in core.** A future, clearly-scoped,
  **read-only** parser the operator points at a single named file *could* be a
  Phase 3 add-on, opt-in and never a writer — but it is out of scope here, and
  the preferred path is container labels (Traefik / `flightdeck.domain`).
- **No arbitrary command execution** — unchanged allowlist.

## Phasing

1. **Phase 1 (all free): BUILT.** ports + container networks + Traefik/`flightdeck`
   route labels + host public IP. Service detail gains an **Exposure** tab; the
   Hosts screen shows each host's public IP and per-service reachability. Zero new
   agent access (all from the existing `list_containers` summary + labels + the
   agent connection). `FD_TRUSTED_PROXY=true` lets the public IP come from
   `X-Forwarded-For` behind a known reverse proxy.
2. **Phase 2 (opt-in):** host LAN IPs via `FD_COLLECT_HOST_IPS`.
3. **Phase 3 (maybe, not now):** read-only, operator-pointed nginx/Caddy config
   reader for shops that can't label their containers.

## Open questions

- Behind Docker's default bridge with no published ports but a reverse proxy on
  the same network, a service may be "reachable" only via the proxy container.
  Phase 1 shows the proxy's public ports + the target's route label; linking the
  two (proxy → upstream) is a nicety, not required.
- IPv6 bind addresses and port ranges need careful `public` derivation; covered
  by treating any non-loopback bind as public.
