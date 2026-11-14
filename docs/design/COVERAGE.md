# Coverage map — Flightdeck design vs. real control-plane API

Status of every screen, drawer, modal and state in the imported design
(`docs/design/source/Flightdeck.dc.html`, re-imported with the extended
Transmitter / Activity / Deploys work) against the control-plane API that
actually exists today.

Legend for **Backend**:

- **exists** — a real endpoint already serves this.
- **partial** — an endpoint exists but the design asks for a field/shape it
  does not provide; the gap column says what.
- **none** — no backend; must be built or mocked. The rule from the brief:
  if the control plane lives in this repo, build it behind a written contract;
  otherwise build a typed client with a mock adapter used only in dev/tests.
- **derived** — not in the design; built from the design system's primitives so
  it looks native ("derived, not designed").

## Real API surface (source of truth for data)

| Endpoint | Returns | Notes |
| --- | --- | --- |
| `GET /api/me` | `{identityEnabled, loginFlow, logSearch, subject, name, roles[], permissions[]}` | Drives permission gating + feature flags (`logSearch`). |
| `GET /api/services` | `{services: ServiceInfo[]}` | `ServiceInfo{id,name,image,containerId,state,host,createdAt,repo?,environment?,env?}` |
| `GET /api/services/:id` | `{service, logs: LogLine[], deploy?, env?}` | `env` masked (`********`) unless caller has `reveal`. `deploy` = latest for the service's repo. |
| `GET /api/services/:id/logs/search?q&from&to&limit` | `{lines: SearchLine[]}` | `404` when Loki is not configured. `from`/`to` default to last hour; `limit` ≤ 5000. |
| `GET /api/deploys?repo&limit` | `{deploys: DeployRecord[]}` | `DeployRecord{id,repo,environment?,sha,branch?,status,runUrl?,actor?,startedAt,updatedAt}`. Filter is by **repo**, not service. |
| `GET /api/audit?limit` | `{audit: AuditEntry[]}` | `AuditEntry{ts, action, serviceId, actor, ok, error?}`, newest-first. Only **actions** are logged (restart/redeploy/set_env), never reads. |
| `POST /github/webhook` | — | HMAC; `workflow_run` → deploy correlation. Inbound only. |
| WS `/stream` | server: `services`,`snapshot`,`log`,`status`,`stats`,`action_result`,`deploy` | client: `subscribe`,`unsubscribe`,`action(restart\|redeploy)`,`set_env`. `stats` is fanned out live, **not retained**. |
| `GET /auth/login`, `/auth/logout`, `/auth/callback` | — | OIDC browser flow (only when `loginFlow`). |

There is **no** Transmitter backend, **no** host-level endpoint, and **no**
retained stats/metrics history. Those drive the gaps below.

## Screens

| Row | In design | API endpoints | Backend | Mismatch / note |
| --- | --- | --- | --- | --- |
| **Sign in** | yes (`signin`) | `/auth/login` | exists | Only shown when `me.loginFlow`; token-bar fallback otherwise. |
| **Overview** | yes (`overview`, badge = attention count) | `/api/services` + WS `stats`/`status` | partial | "Attention" count and per-service CPU/mem come from the live `stats` stream (not retained) — compute client-side, show "—" before first sample. |
| **Deploys** (global) | yes (`deploys`) | `/api/deploys` | exists | Filter by **project** = `repo`, by **status** = `DeployRecord.status`. "Filter by service" is derived by matching `service.repo` (deploys are repo-keyed, not service-keyed) — note in UI. |
| **Activity / Audit** | yes (`activity`/`audit`) | `/api/audit` | exists | Columns actor, action, target(=`serviceId`), ok/fail, time. Read-only; no control in it can trigger an action. No `project` field on entries → filter by service id only. |
| **Transmitter** | yes (`transmitter`, badge = unread signals) | — | **none** | Sources → routes → channels. Build UI on a typed client + **mock adapter** (dev/tests only); contract in `TRANSMITTER-API.md`. Signals/unread badge is a Transmitter concept with no current backend. |
| **Hosts** | yes (`hosts`, badge = online/total) | `/api/services` (grouped by `host`) | partial | No host-level endpoint. Derive hosts from `ServiceInfo.host`; "online" = has ≥1 running service / live WS. Agent version, OS, uptime shown in design have **no API field** → omit + log. |
| **Service detail** | yes | `/api/services/:id` + WS | exists | Env masked unless `reveal`. Restart/redeploy gated by `act`; set_env by `reveal`. |
| **Project** | yes (`project`) | `/api/services` grouped by `repo`/`environment` | partial | No project entity; a "project" is the set of services sharing `repo`. Project-level metadata in design (description, links) has no API → omit + log. |
| **Settings** | yes (`settings`: `roles`, `tokens`, `vars`) | `/api/me` | partial | Roles/permissions are read-only from `me`. Token/var management in design has no write endpoint → show read-only state + "managed by operator" + log the gap. |

## Drawers, modals, overlays

| Row | In design | API | Backend | Note |
| --- | --- | --- | --- | --- |
| **Command palette** | yes | client-only | derived-ok | Navigates screens + jumps to services; no API. |
| **Connect agent** drawer | yes | — | none(info) | Static instructions + token display; no live provisioning endpoint. Show copyable `fd-agent` bootstrap, no secret echo. |
| **Env edit** modal | yes | WS `set_env` | exists | Requires `reveal`; disabled with reason otherwise. |
| **Confirm action** (restart/redeploy) | yes | WS `action` | exists | Requires `act`. Safety: never fire against real infra while testing. |
| **Channel editor** (Transmitter) | yes | — | none | Credentials write-only; UI shows "set, updated …" + replace. |
| **Route editor** (Transmitter) | yes | — | none | Match on type/severity/project → channels; throttle/quiet-hours/mute. |
| **Source editor** (Transmitter) | yes | — | none | Inbound webhook token shown once, hashed at rest, rotate/revoke. |
| **Send test** (channel) | yes | — | none | Mock sink only; never send real notifications. |

## Global states

| Row | In design | Mechanism | Backend | Note |
| --- | --- | --- | --- | --- |
| **Stream stale** | yes ("stale" ×16) | WS last-event timestamp + auto-reconnect | exists | Indicator shows time since last event; reconnect with backoff. |
| **Actions disabled** | yes ("disabled" ×20) | global banner + disable all action controls | exists | Driven by server `actionsEnabled` + permission helper. |
| **No env collected** | yes | empty state on env panel | exists | `env === undefined` → "what to do next". |
| **Permission denied** | yes | permission helper (`can().reason`) | exists | Consistent disabled-with-reason, never a silent no-op. |
| **Loading / empty / error / partial** | per screen | TanStack Query states | exists | Every screen gets all four. |

## Fields the design shows that the API does not have (left out + logged)

- Host agent version, OS, uptime, CPU/mem per host.
- Project description, repo links, owners.
- Settings: editable tokens and variables (no write endpoint).
- Retained metric history / sparklines beyond the live `stats` stream.
- Transmitter entirely (mock + contract).

## API data the design never shows (left out + logged)

- `ServiceInfo.containerId`, `createdAt` (partially used).
- `DeployRecord.environment` filtering is available but the design's deploy
  filter only exposes project + status.
- `/api/health`, `/metrics`, `/healthz`, `/readyz` (ops endpoints, not UI).

## Derived (not designed) items built from design primitives

- "Filter deploys by service" (maps through `service.repo`).
- Hosts screen derivation from `ServiceInfo.host` (no host endpoint).
- Project grouping from `repo`/`environment`.

## Build status (final)

| Screen / feature | Built | Data |
| --- | --- | --- |
| Overview | ✅ | real (`/api/services` + WS) |
| Service detail (logs, stats, status, actions, env, deploy) | ✅ | real (WS + `/api/services/:id`) |
| Hosts | ✅ | derived from `ServiceInfo.host` |
| Project | ✅ | derived from `repo`/`environment` |
| Deploys | ✅ | real (`/api/deploys`) |
| Activity / Audit | ✅ | real (`/api/audit`, read-only) |
| Durable log search | ✅ | real (`/logs/search`, gated by `me.logSearch`) |
| Settings | ✅ | real (`/api/me`, read-only) |
| Sign in | ✅ | real (`/auth/login` + token fallback) |
| Transmitter (signals/channels/routes/sources/delivery) | ✅ | **real backend** (control-plane) + mock fallback for preview/tests |
| Global states (stale, actions-disabled, no-env, permission-denied) | ✅ | real |
| Command palette, connect-agent drawer | ✅ | real / static |

All screens have loading, empty and error states, and every screen — including
the Transmitter — runs on a real backend. The Transmitter falls back to the
clearly-separated mock (with a preview banner) only when the backend is disabled
(`FD_TRANSMITTER=false`).
