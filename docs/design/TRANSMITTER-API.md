# Transmitter API contract

The backend contract for the Transmitter (notifications hub).

**Status: implemented.** The control plane lives in this repo, so the backend is
built under `apps/control-plane/src/transmitter/` (store + dispatcher + senders +
SSRF guard + routes) and `/api/me` reports `transmitter: true` when it is on
(`FD_TRANSMITTER`, default on; `FD_TRANSMITTER_DB_FILE` to persist, else
in-memory). The web UI uses the real HTTP client
(`apps/web/src/lib/transmitter/httpAdapter.ts`) when the backend is present and
falls back to the in-memory mock (with a visible "preview" banner) otherwise. The
mock is also what the UI tests import.

This document remains the source of truth for the wire shapes.

Model: **sources in → routes → channels out.**

## Conventions

- Base path: `/api/transmitter`. All endpoints require the same auth as the rest
  of the control plane and the `act`/`reveal` permission model where noted.
- JSON request/response. Timestamps are epoch milliseconds.
- All create/update/delete of a source, channel or route is written to the audit
  log, **with secrets redacted**.

## Signals (in-app feed)

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/signals` | `{ signals: Signal[] }` newest-first |
| POST | `/signals/:id/read` | `204` |
| POST | `/signals/read-all` | `204` |

`Signal { id, ts, severity: 'info'|'warning'|'error'|'critical', title, body?, source, read }`

## Channels (outbound)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/channels` | `{ channels: Channel[] }` — **never** includes secrets |
| POST | `/channels` | body `ChannelInput`; `credential` write-only |
| PUT | `/channels/:id` | `credential` omitted = keep existing |
| DELETE | `/channels/:id` | also removes the channel from routes |
| POST | `/channels/:id/test` | returns a `Delivery`; sends a real test notification |

`Channel { id, kind, name, config, enabled, credentialSet, credentialUpdatedAt? }`
— `config` holds only non-secret fields (chat id, from/to, webhook URL).
`ChannelInput { kind, name, config, enabled, credential? }`.

**Security — channel credentials are write-only.** Bot tokens, SMTP passwords
and webhook secrets are accepted on create/update and **never returned** by any
endpoint. The API exposes only `credentialSet` and `credentialUpdatedAt`. The UI
shows "set, updated …" with a Replace action.

## Routes

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/routes` | `{ routes: RouteRule[] }` |
| POST | `/routes` | body `RouteInput` |
| PUT | `/routes/:id` | full replace (also used to toggle `muted`) |
| DELETE | `/routes/:id` | |

```
RouteRule {
  id, name,
  match: { eventTypes: string[], minSeverity: Severity, projects: string[] },
  channelIds: string[],
  throttlePerMin?: number,
  quietHours?: { start: 'HH:MM', end: 'HH:MM' },
  muted: boolean
}
```

Matching: a signal matches when its severity ≥ `minSeverity`, its event type is
in `eventTypes` (or the list is empty), and its project is in `projects` (or the
list is empty). The dispatcher enforces `throttlePerMin`, suppresses during
`quietHours` (server local time), and skips muted routes.

## Sources (inbound)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/sources` | `{ sources: Source[] }` — token hint only, never the token |
| POST | `/sources` | body `{ name }`; returns `{ source, token }` **once** |
| POST | `/sources/:id/rotate` | returns `{ source, token }` **once** |
| DELETE | `/sources/:id` | revoke (builtin source cannot be revoked) |
| POST | `/transmitter/ingest/:sourceId` | inbound webhook; **outside `/api`** (like the GitHub webhook), authenticated by the source token |

`Source { id, kind: 'builtin'|'webhook', name, enabled, tokenHint?, createdAt }`

**Security — inbound tokens.** Generated server-side, returned exactly once at
create/rotate, and **stored only as a hash** (e.g. SHA-256). `tokenHint` is the
last 4 characters for identification. `/ingest/:sourceId` authenticates the
`Authorization: Bearer <token>` against the stored hash.

**Inbound hardening.** `/ingest` is rate-limited per source, the payload is
size-capped (e.g. 64 KiB) and schema-validated before it becomes a signal.

## Deliveries

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/deliveries` | `{ deliveries: Delivery[] }` newest-first |

`Delivery { id, ts, channelId, channelName, routeId?, signalTitle, ok, error? }`

## Dispatcher & outbound hardening

- **SSRF protection:** outbound generic webhooks (and any user-supplied URL)
  must block requests to cloud metadata endpoints (`169.254.169.254`),
  link-local and loopback ranges, and private ranges unless explicitly allowed.
- **Timeouts + retries:** bounded timeout per send, with retry and exponential
  backoff; failures are recorded as a `Delivery` with `ok: false` and the error.
- **No secret logging:** credentials and inbound tokens never appear in logs,
  deliveries or audit entries.
- **Senders:** Telegram (fixed API host) and the webhook family (Discord, Slack,
  generic webhook, custom connector) are implemented over HTTPS POST. **Email
  (SMTP) is not implemented in this build** — the channel kind exists and a test
  returns a clear "SMTP sender is not implemented" delivery error; wiring an SMTP
  library is the one remaining sender.

## Permissions

- Viewing signals and the delivery log: `view`.
- Managing channels, routes and sources, and sending tests: `act` (or a
  dedicated `transmitter` permission if the model is extended).
- Revealing a credential is impossible by design (write-only), so no `reveal`
  path exists for them.
