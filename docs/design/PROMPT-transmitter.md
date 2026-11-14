# Transmitter — designer prompt & import reference

This records the prompt sent to the Claude Design conversation to extend the
Flightdeck design with the **Transmitter** (in-app notifications hub + outbound
channels), so the history of how the design grew is complete. The extended
design that resulted is imported below.

## Import reference

- **Project:** Railway-inspired GUI design
- **Design project:** <https://claude.ai/design/p/fffa81e8-2a09-4c51-a7a2-304a49aee443?file=Flightdeck.dc.html>
- **Imported files:** `Flightdeck.dc.html` (implemented), `support.js` (dc-runtime, read-only reference, not shipped)
- **Local copies:** `docs/design/source/Flightdeck.dc.html`, `docs/design/source/support.js`
- **Re-imported:** 2026-11-14 (extended design with Transmitter / Activity / Deploys)

## The prompt (as sent to the design conversation)

> Add a **Transmitter** screen to Flightdeck, in the same visual language as the
> rest of the design (same tokens, typography, spacing, iconography, both
> themes). Nav entry: label "Transmitter", icon `ph-broadcast`, with an unread
> badge.
>
> The mental model is **sources in → routes → channels out**:
>
> - **Sources (incoming):** Flightdeck's own events (always on), plus inbound
>   webhooks each with a per-source token. This is how flightdeck-watcher,
>   Grafana alerts and arbitrary systems push events in.
> - **Channels (outgoing):** Telegram, Email/SMTP, Discord, Slack, generic
>   Webhook, and a Custom channel. Each channel has a "send test" action.
> - **Routes:** match on event type, severity and project, and fan out to one or
>   more channels. Routes support throttling, quiet hours and mute.
>
> Screens/sections to design:
>
> 1. Transmitter home: a signal feed (in-app notifications, read/unread), with
>    filters by severity and source.
> 2. Channels list + channel editor drawer. Credentials (bot tokens, SMTP
>    passwords, webhook secrets) are **write-only**: after saving, show
>    "set, last updated …" with a Replace action, never the secret.
> 3. Sources list + source editor. Inbound webhook token is shown once at
>    creation, stored hashed, and can be rotated/revoked.
> 4. Routes list + route editor (match rules → channels, throttle, quiet hours,
>    mute toggle).
> 5. Delivery log: what was sent where, when, and success/failure.
>
> Keep every control keyboard-accessible with visible focus, and design the
> empty, loading and error states for each list.

## Security constraints carried into the build (non-negotiable)

- Channel credentials are **write-only** — never returned by the API or shown
  after saving. UI shows "set, updated …" + Replace.
- Inbound webhook tokens: hashed at rest, shown once, rotatable, revocable.
- Outbound generic webhooks block cloud metadata + link-local addresses by
  default; timeouts + retries with backoff.
- Every create/update/delete of a source, channel or route is audited, secrets
  redacted.
- Inbound endpoints are rate-limited; payloads size-capped and validated.

## Build note

No Transmitter backend exists in the control plane today. Per the brief, the UI
is built against a **typed client with a clearly separated mock adapter**
(dev/tests only), and the backend contract is written first in
`docs/design/TRANSMITTER-API.md` for the backend team.
