# Flightdeck-Watcher 📡

The **warm path** to Flightdeck's hot path. Where `flightdeck` answers
_"what is running right now, what is it logging, did my deploy go out?"_,
`flightdeck-watcher` answers _"what happened over the last 21 days, and page me
when it goes wrong."_ Durable logs, metrics, and alerts-as-code — self-hosted,
one `docker compose up`.

They are two halves of one project and share one vocabulary: the same
low-cardinality labels (`service`, `env`, `project`).

```
  emitters ──NDJSON──► Vector ──► Loki ─────────┐
  (any app)                                      ├──► Grafana  (logs + alerts-as-code)
  scrape targets ───────────────► Prometheus ───┘
  active HTTP checks ───────────► status page   (Kuma-style, our own style)
```

## Quick start

```bash
cp .env.example .env         # set the ingest tokens
docker compose up --build
```

Then open:

| Surface            | URL                     | What it is                                    |
| ------------------ | ----------------------- | --------------------------------------------- |
| **Status page**    | http://localhost:8090   | public-safe at-a-glance board                 |
| **Grafana**        | http://localhost:3320   | logs explorer + provisioned alerts            |
| **Prometheus**     | http://localhost:9310   | metrics + scrape targets                      |
| Loki               | http://localhost:3310   | query API (localhost-only)                    |
| Gateway            | http://localhost:8410   | the bearer-gated ingest door                  |

Send a test log straight at Vector:

```bash
curl -s localhost:9000 -H 'content-type: application/x-ndjson' \
  --data-binary '{"service":"demo","level":"error","msg":"canary"}'
# watch it land in Grafana → Explore → Loki:  {service="demo"}
```

## How Flightdeck plugs in (no code changes)

Flightdeck is already a **producer** for this stack:

- **Logs.** The control plane ships every line to Loki when `FD_LOKI_URL` is set
  (see `apps/control-plane/src/loki.ts`). Point it at the gateway:
  `FD_LOKI_URL=http://<host>:8410` with the project's bearer token.
- **Metrics.** The control plane already serves Prometheus `/metrics`
  (`flightdeck_log_lines_total`, `flightdeck_actions_total`,
  `flightdeck_deploys_total`, …). Prometheus here scrapes it — see the
  `flightdeck-control-plane` job in `prometheus/prometheus.yml`.

The division of labour, stated once: on a host with a Flightdeck agent, the
**agent** forwards that host's container logs. Vector is for everything else —
cross-project services, serverless, app-level metrics. **One path per source,**
or you double-ship and pay twice.

## Two design rules (the actual engineering judgment)

1. **Low label cardinality.** Only `service`, `env`, `project` become Loki
   streams. Everything else stays inside the log line and is searched with
   LogQL. Label something high-cardinality (`user_id`, `request_id`) and you
   create one index stream per value — the classic way to OOM Loki or blow up
   the bill.
2. **Private by default, one narrow public door.** Loki has no auth
   (`auth_enabled: false`). It is never exposed. The only internet-facing thing
   is `loki-gateway`, which checks a per-project bearer token and reverse-proxies
   to the private Loki. A misconfiguration denies access rather than granting it.

## Alerts as code

Alert rules live in `grafana/provisioning/alerting/*.yaml`, baked into the
Grafana image at build time. Rebuild the image and the rules are live — a
merge to main is a deploy. Two examples ship:

- `logs-error-rate.yaml` — fires on a LogQL error-rate spike (A query → B reduce
  → C threshold).
- `control-plane-down.yaml` — fires when Prometheus loses the Flightdeck
  control-plane scrape.

### The four hard-won gotchas (baked in here so you don't relearn them)

1. **`noDataState: KeepLastState` crash-loops provisioning.** It is a legal
   value in the UI but is **rejected in a provisioning file** and takes Grafana
   into a boot crash-loop. Only `OK`, `NoData`, `Alerting` are valid in files.
   The logs rule uses `OK` ("no error logs" = healthy); the down rule uses
   `NoData` ("target vanished" = unknown, not healthy). The choice is per-rule.
2. **Datasource UID, not name.** Rules reference datasources by UID. Omit `uid:`
   and Grafana derives one by hashing `name + orgId` (stable across rebuilds).
   We **pin** `flightdeck-loki` / `flightdeck-prom` explicitly so the rules are
   self-evidently correct and nothing breaks on redeploy. The trap is assuming
   the UID is random and templating it.
3. **Retention is two settings.** `retention_period` marks data eligible for
   deletion; nothing is deleted unless the compactor has `retention_enabled:
   true`. Both are set in `loki/loki-config.yaml`. Set one and disk never frees.
4. **Tune thresholds on real data.** The error-rate threshold is a placeholder
   (`gt 50`). Measure your own p90 over a couple of weeks and set it above the
   chronic baseline, or you page on noise.

### The declarative / imperative seam

The rules carry only a `severity` label and provision **no** contact point or
notification policy — on purpose. Provisioning a notification policy is a
full-tree replace: it throws away any policy made in the UI. So rules stay
declarative (in git) and routing stays in the UI; they meet through the
`severity` label the UI policy matches on.

## The status page

`status/` is a ~150-line, zero-dependency Node service: it actively HTTP-checks
each monitor in `status/monitors.json`, keeps a rolling in-memory history, and
serves a styled board at `/`, JSON at `/api/status`, and Prometheus text at
`/metrics` (so Prometheus scrapes the watcher too — the loop closes).

History is intentionally ephemeral (restart = fresh slate): the right trade for
an at-a-glance board, not an SLO system. Add monitors by editing
`monitors.json` — `accept` lists the HTTP status codes that count as up.

## Layout

```
flightdeck-watcher/
  docker-compose.yml        the whole stack
  vector/vector.yaml        collector/forwarder (NDJSON -> Loki)
  loki/loki-config.yaml     storage + index (tsdb v13, 21d retention)
  loki-gateway/Caddyfile    the bearer-gated public door
  prometheus/prometheus.yml metrics store + scrape jobs
  grafana/                  Dockerfile + provisioning (datasources, alerts, dashboard)
  status/                   Kuma-style status page (server.mjs + index.html)
```
