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
- **Email/SMTP sender is deferred.** Every sender is implemented except Email,
  which would need an SMTP library; the channel kind exists and returns a clear
  "not implemented" error on send/test. How to change: add an SMTP sender in
  `transmitter/senders.ts`.
