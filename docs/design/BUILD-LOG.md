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
