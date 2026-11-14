# Design map — Flightdeck.dc.html → apps/web

Maps the imported Claude Design (`docs/design/source/Flightdeck.dc.html`, a
Railway-inspired GUI) onto the real control-plane API and the existing
`apps/web`. Source of truth for Phases C–F. All data classifications use the
real API inventory in `MISSION_LOG.md`.

## What `support.js` is

The Claude Design canvas runtime ("GENERATED from dc-runtime/src/\*.ts — do not
edit"): it parses the `<x-dc>` template + `data-dc-script` and renders it with
React on the design canvas. **Design-tool scaffolding, not product behavior.**
It is NOT shipped. It is replaced wholesale by the real `apps/web` React app.
The *behavior* expressed in the doc's `data-dc-script` (the action handlers) is
reproduced as real React wired to the control-plane API — see Actions below.

## Screens → routes

The design is a single-page app shell with hand-rolled view switching
(`state.screen` ∈ {signin, home}; `state.home` ∈ {overview, hosts, settings};
plus service/project detail via `sel`). This matches the existing app's
hand-rolled `selectedId` pattern — **no router dependency is added**.

| Design screen | Nature | Target in apps/web |
| --- | --- | --- |
| Sign-in | new | New `SignIn` view (wraps existing TokenBar + OIDC loginUrl) |
| Overview | redesign of current list | New `Overview` (replaces ServiceList-as-whole-screen) |
| Service detail | redesign | New `ServiceDetail` (reuses LogViewer, EnvPanel logic) |
| Project detail | new | New `ProjectView` (services filtered by `flightdeck.repo`/project) |
| Hosts | new | New `Hosts` view |
| Settings | new | New `Settings` view (theme, identity info) |
| Command palette | new | `CommandPalette` overlay (Cmd-K) |
| Connect-agent drawer | new | `ConnectAgentDrawer` (copy run command) |

## Regions / components (reading order)

1. **App shell**: left sidebar nav (Overview, Hosts, Settings; project switcher at
   top), top bar (search/palette trigger, theme toggle, user menu), main content.
2. **Overview**: attention strip (exited/failing services), project groups, each
   with a table/cards of services → status pill, host, image, CPU%, memory,
   restarts, last deploy.
3. **Service detail**: header (name, status, host, image, actions:
   restart/redeploy), tabs/sections → live logs (pausable, auto-scroll), CPU/mem,
   env (masked/reveal/edit), deploy history.
4. **Hosts**: host cards (online/offline, runtime, service count), agent tokens
   table (name, fingerprint, created, last-used, revoked), connect command.
5. **Settings**: theme toggle, identity/auth status, security notes.
6. **Primitives** (repeated): StatusBadge, Card, Table/Row, Dialog (confirm),
   Toast, Drawer, EmptyState, Loading/Skeleton, Button, IconButton, Tag, Meter
   (CPU/mem bar), SegPill (segmented control), Sparkline.

## Design tokens

40 light + 38 dark CSS custom properties. Exact values vendored to
`docs/design/source/tokens.json` (extracted from the source `:root` blocks) and
moved into `apps/web/src/index.css` as `@theme` + `:root`/`[data-theme]` in
Phase C. Highlights: accent `--accent:#f5b83d` (amber/gold), semantic
`--green/--red/--blue`, surfaces `--bg0..3`, text `--text/2/3`, `--line/2/3`,
error/warn rows. **Light + dark both defined** → the app gains a theme toggle
(currently dark-only). Fonts: Geist (UI), Instrument Sans, JetBrains Mono
(code). Icons: Phosphor (36 used). See §1.3 handling below.

## Self-contained (§1.3) handling

| Asset | In design | Plan |
| --- | --- | --- |
| Google Fonts (Geist, Instrument Sans, JetBrains Mono) | CDN `fonts.googleapis.com` | **Decision (DECISIONS D-004):** use a close system stack now (zero binary, fully self-contained); woff2 self-host filed as follow-up. All three are OFL so bundling is license-OK later. |
| Phosphor icons | CDN `unpkg.com` | **Decision (DECISIONS D-005):** vendor the 36 used icons as inline SVG React components (Phosphor is MIT). No runtime CDN, no new dep. |
| `http://api:8080`, `prometheus:9090`, `grafana.acme.dev`, `o91.ingest.example.io` | in design | **Demo sample data strings**, not dependencies. Not shipped; real values come from the API. |

## Data sources (a=exists · b=derive in control-plane · c=protocol+agent change · d=unsupportable)

| Data element | Class | Evidence / plan |
| --- | --- | --- |
| Service list, name, image, host, repo, environment | a | GET /api/services → ServiceInfo |
| Service status (created/running/restarting/paused/exited/dead) + exit code | a | ServiceInfo.state; WS `status` {state,exitCode} |
| "deploying"/"pending" status | a* | UI-transient only: set locally while a redeploy action is in flight; not a container state |
| Live logs (stream, snapshot tail) | a | WS subscribe→snapshot/log |
| Pause/resume log stream, auto-scroll | a | client-side (design `togglePause`); existing LogViewer |
| CPU % / memory (live, detail) | a | WS `stats` {cpuPct,memBytes,memLimitBytes} |
| CPU % / memory on **overview** (all services) | b | store does not retain last stats; add last-stats retention + expose (no protocol/agent change). If not done this session: honest "—" on overview, live on detail. |
| Env vars (keys) | a | GET /api/services/:id → env (masked) |
| Env reveal (unmask one/all) | a | `reveal` permission unmasks server-side; UI gates the control |
| Env edit → recreate container | a | WS set_env (admin/`reveal`); confirm dialog states recreate |
| Deploy: sha, branch, status, actor, runUrl, started/updated | a | DeployRecord via /api/deploys + WS `deploy` |
| Deploy commit **message** | c | not in DeployRecord; webhook payload has head_commit.message → add field (backward-compat optional) + mirror. Else honest N/A. |
| Deploy **duration** | b | updatedAt − startedAt (derive client-side) |
| Deploy CI **run number** | c | not stored; workflow_run.run_number in payload. Else show runUrl link only. |
| Restart **count** per service | c | not tracked anywhere. Control-plane could count status→restarting or action dispatches (b-ish) but needs new state. Default: honest "—" + issue. |
| Host list + online/offline | b | derive from agent connections (agent-hub tracks connected agents). No HTTP endpoint today → add GET /api/hosts. Else derive host set from services + mark online if any service seen recently. |
| Host **runtime** (docker/podman/systemd) | c | AgentHello has only agentId+hostname. Add `runtime` to hello + mirror in agent. Else N/A. |
| Agent tokens: list/create/revoke from UI | d | File-based (FD_AGENT_TOKENS_FILE, credentials.ts). No HTTP CRUD; adding a privileged mutation surface over agent credentials is security-sensitive and out of §1 scope. **Render connect-command (static) + honest "managed via FD_AGENT_TOKENS_FILE" state; file issue.** |
| Connect-agent command snippet | a | static text (host, token placeholder, control-plane URL); copy to clipboard |
| Audit log view | a | GET /api/audit (exists; design doesn't surface it directly but useful for Settings) |
| Attention items (exited/failing) | b | derive from services where state ∈ {exited,dead} or exitCode≠0 |
| Project grouping | b | derive: group services by repo/`flightdeck.repo` (or environment). Design's "project" = repo. |
| User identity, roles, permissions | a | GET /api/me |
| Theme (light/dark) | a | client-side; persisted in localStorage (per-viewer) |

`a*` = exists as a derived UI-only transient, not a backend field.

## Actions, permission, confirmation

| Action (design handler) | API | Permission | Confirm? |
| --- | --- | --- | --- |
| restart | WS action:'restart' | `act` | **YES** (design lacks it; §1 mandates — names service+host) |
| redeploy | WS action:'redeploy' | `act` | **YES** (names target image/sha, states recreate) |
| reveal env | HTTP detail unmask | `reveal` | no (but audited server-side) |
| edit/save env | WS set_env | `reveal` (admin) | **YES** (states "recreates the container with the new environment") |
| sign in / out | /auth/login, /auth/logout, token | n/a | no |
| newToken / revoke token | — | — | **d: not implemented** (see above) |
| toggle theme, palette, drawers, pause | client-side | n/a | no |

Read-only (`view` only) users: restart/redeploy/edit controls are **hidden or
disabled with reason**; env stays masked (no reveal control). Server enforces
all three regardless of UI (verified in Phase E3).

## States (per §3) — design coverage + where we add missing ones

| State | In design? | Plan |
| --- | --- | --- |
| loading | partial | Skeletons on Overview/detail |
| empty: no agents | no → **ours** | Hosts empty = "Connect your first agent" (connect drawer) |
| empty: no services | partial | Overview empty = "No services yet" + label hint |
| agent disconnected/stale | partial | Host offline pill; service "stale since <t>" when stream drops |
| running / restarting / exited(+code) | yes | StatusBadge variants |
| errors | partial | Toasts + inline error rows (design `--errrow`) |
| unauthorized / forbidden | partial | SignIn for 401; disabled-with-reason for 403 |
| read-only role | yes (implied) | permission helper hides/disables controls |
| very long logs | n/a | keep existing bounded/virtualized LogViewer (§1.5) |
| many services | n/a | project grouping + (future) virtualization |

## Deviations (log as they occur in DECISIONS.md)

- Fonts: system stack vs the design's Geist/Instrument Sans (D-004).
- Confirm dialogs added to restart/redeploy where the design omitted them (security §1).
- Agent-token management rendered read-only / N/A (D class).
