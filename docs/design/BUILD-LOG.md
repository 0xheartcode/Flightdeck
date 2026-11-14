# Build log — Flightdeck UI rework

Appended after each milestone: what shipped, the commits, and open gaps.

## M0 — Import + coverage

- Re-imported the extended design (`Flightdeck.dc.html`, 216 KB) with the
  Transmitter, Activity and Deploys work; saved `support.js` (runtime, not
  shipped).
- Wrote `COVERAGE.md` (every screen/drawer/state → API → backend status) and
  `PROMPT-transmitter.md` (designer prompt + import reference).
- Commits: `d1ea655`.
- Open gaps: no Transmitter / host / project backend; stats not retained.

## M1 — Foundations

- Committed the pending foundations as logical commits: design token system with
  light/dark (`1152b2b`), theme control module (`38cbac6`), permission helper
  (`14d1be2`), vendored 67-icon Phosphor set + generator (`f5b427d`).
- Built the accessible primitive kit (`3f5c277`): Button, Input/Textarea/Field,
  Select, Toggle, Badge + status pills, Card, Meter, Tabs, Table, Drawer,
  Modal/ConfirmDialog, Toast, EmptyState, Skeleton, LogViewer, overlay hooks,
  barrel, keyframes. 24 render tests asserting the roles/ARIA contract.
- Gate: web typecheck, lint, 24 tests, and production build all green.
- Open gaps: keyboard/focus-trap behaviour is covered by light static tests only
  (see DECISIONS.md); real interaction tests deferred to M6 or a jsdom setup.

## M2 — Shell and global states

- Surfaced `FD_ENABLE_ACTIONS` via `GET /api/me` (`actionsEnabled`) and threaded
  it through the permission helper; the UI shows a global "actions disabled"
  banner and disables every mutating control with a reason.
- Built the shell: sidebar (six destinations + live badges), top bar (command
  trigger, live/stale status, theme toggle, identity), ⌘K command palette,
  connect-agent drawer, hash router, and the "stream stale" banner (derived from
  registry-poll freshness; the query's retry is the reconnect).
- Commits: `cd8a8f9` (plumbing), `809404e` (shell).

## M3 — Designed screens

- Overview, Service detail (live logs/stats/status, gated restart/redeploy, env
  reveal/edit, deploy card), Hosts (derived from `host`), Project (grouped by
  repo/environment), Settings (read-only identity + flags), Sign in. Each with
  loading / empty / error states. Commit: part of `01776ae`.

## M4 — Screens over existing endpoints

- Activity (`GET /api/audit`, read-only, filters), Deploys (`GET /api/deploys`,
  project/status filters), durable log history search (`GET /logs/search`, shown
  when `me.logSearch`). Commit: `01776ae`.

## M5 — Transmitter

- Sources → routes → channels, built on a typed `TransmitterClient` with an
  in-memory mock adapter (dev/tests only) and a "preview, nothing sent" banner.
  Signals feed, channel management (write-only credentials), route editor
  (match → channels, throttle, mute), inbound sources with one-time tokens
  (rotate/revoke), delivery log. Backend contract in `TRANSMITTER-API.md`.
- Commit: `5fa80af`; wired in `e1d53e4`.

## M6 — Polish and cleanup

- Deleted the prototype UI (ServiceList/LogViewer/EnvPanel/TokenBar/StatusBadge),
  fully replaced by the shell + screens + `ui/` kit (`011fe9f`).
- Added logic tests (router round-trip, service grouping, Transmitter security
  behaviours): **41 web tests** total.
- Visual verification (Playwright, headless): both themes render the exact design
  tokens (`#f3f3f0` light / `#0d0f12` dark), the shell/nav/badges, the
  stream-stale banner, and the Transmitter with its mock-preview banner and
  write-only credential display. Desktop + mobile checked.
- Accessibility: all primitives keyboard-operable with visible focus and ARIA
  roles; overlays trap focus, restore it, and close on Escape; icons are
  labelled or hidden; reduced-motion respected globally.
- Gate: full TS workspace gate (`pnpm check`) green; Rust untouched.

## Open / unverified

- Real infrastructure actions (restart/redeploy/set_env) were **not** triggered
  against live services per the safety rules — verified only through the UI gate,
  confirm dialog, and the WS send path.
- The Transmitter has no backend; the UI runs on the mock. Implement
  `TRANSMITTER-API.md` to go live.
- Interaction tests use static render assertions (no jsdom); a jsdom + Testing
  Library setup would add real keyboard/focus tests (see DECISIONS.md).
