# Design-build decisions

One line each: the decision, why, and how to change it. Appended as the
autonomous UI build makes choices the brief left open.

## Foundations (M1)

- **Light render tests via `react-dom/server` `renderToStaticMarkup`, not
  jsdom + Testing Library.** Why: the repo had no component-test setup; this adds
  real render assertions (roles, ARIA, tone) with zero new dependencies, keeping
  the gate stable. How to change: add `jsdom` + `@testing-library/react`, set
  vitest `environment: 'jsdom'`, and convert the tests to interaction tests
  (needed to cover keyboard/focus-trap behaviour, which static markup can't).
- **Native `<select>` for the Select primitive.** Why: correct keyboard,
  typeahead and mobile pickers for free. How to change: build a custom listbox
  (ARIA `listbox`/`option`) only if the design needs rich option rendering.
- **67 Phosphor icons vendored inline as static SVG path data.** Why: no runtime
  CDN dependency; glyphs flip with the theme via `currentColor`. How to change:
  edit the name list in `apps/web/scripts/gen-icons.mjs` and re-run it.
- **Overlay focus management is hand-rolled (`overlay.ts`).** Why: avoids a
  headless-UI dependency for a focus trap + scroll lock + Escape we fully control.
  How to change: swap for a vetted library if the matrix of edge cases grows.

## Data mapping (from COVERAGE.md)

- **Deploys filter by `repo` (= project); "by service" is derived** through
  `service.repo`, because deploys are repo-keyed, not service-keyed. How to
  change: add a service column to the deploy store and a service filter to
  `/api/deploys`.
- **Hosts and Project screens are derived from `ServiceInfo`** (`host`, `repo`,
  `environment`); there is no host or project entity in the API. How to change:
  add host/project endpoints and swap the derivation for real data.
- **Transmitter backend is implemented in the control plane** (the control plane
  lives in this repo, so per the brief's M5 rule the real API + dispatcher are
  built, not just a mock). Storage is SQLite (in-memory by default,
  `FD_TRANSMITTER_DB_FILE` to persist); credentials are write-only; inbound
  tokens are SHA-256 hashed and shown once; outbound webhooks are SSRF-guarded.
  The UI uses the HTTP client when `me.transmitter` is true and the mock (with a
  preview banner) otherwise. The typed client + mock remain for dev/tests. How to
  change: the contract is `TRANSMITTER-API.md`.
- **All senders implemented**, including Email/SMTP via `nodemailer`. A channel
  with incomplete config fails the send cleanly rather than connecting.
- **Interaction tests now run on jsdom + Testing Library** (reversing the earlier
  zero-dep decision, now that the UI milestone is substantial): real click,
  keyboard and focus/Escape tests for Toggle, Tabs, ConfirmDialog and Drawer, in
  addition to the static render tests. vitest `environment: 'jsdom'`.
- **Hosts topology "map" was not built as a screen.** The design's `map` view is
  the command palette's jump-to map, and the designed Hosts screen shows host
  metadata (runtime, OS, agent version, IP, cores) the API does not expose — so
  per the no-fake-data rule it is omitted. Instead the command palette gained
  projects (and keeps services) as real jump targets.
- **User & agent-token management built as a real backend (opt-in).** The design
  showed Settings tabs for user roles and agent tokens that the API did not back.
  Rather than fake forms, two self-managed, admin-gated, audited stores were
  built, both OFF by default (they widen runtime access): local users
  (`FD_LOCAL_USERS`; username + scrypt password → the existing session cookie;
  roles viewer/operator/admin map to view/act/reveal) and managed agent tokens
  (`FD_AGENT_TOKEN_STORE`; issued once, SHA-256 hashed, consulted alongside the
  static `FD_AGENT_TOKEN[S]`). Chosen to fit the existing architecture (external
  IdP for humans, static tokens for agents) as *additional* paths, not a
  replacement. Enabling local users makes `/api` require auth even with OIDC off;
  `FD_BOOTSTRAP_ADMIN` seeds the first admin; a last-admin guard prevents
  lock-out; `/auth/methods` publicly advertises sign-in methods so the login
  screen renders the right form. How to change: see `docs/security.md`.

- **Exposure & routing awareness built read-only (Phase 1).** Flightdeck now
  surfaces how each service is reachable — published host ports (with a
  public-vs-localhost flag derived from the bind address), Docker-network IPs,
  and domains parsed from container labels (Traefik router rules and a native
  `flightdeck.domain`) — grouped per host with the host's public IP. The public
  IP is observed by the control plane from the agent's connection (never
  self-reported); `FD_TRUSTED_PROXY=true` lets it come from `X-Forwarded-For`
  behind a known proxy. Deliberate boundaries, to preserve the agent's
  allowlist-only security model: all data is derived from metadata the agent
  already reads (the `list_containers` summary + labels) with **no new Docker
  calls**, there is **no host OS port scan** (only container-published ports),
  **no proxy config-file parsing** (routing comes from labels), and **no writes**.
  Reading the host's own LAN interfaces (`FD_COLLECT_HOST_IPS`) is the one
  genuine access-widening and is **held, off by default, pending approval**; an
  nginx/Caddy config reader is backlog. Full contract: `EXPOSURE-API.md`.
