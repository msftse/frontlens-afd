# FrontLens

**A log explorer for [Azure Front Door](https://learn.microsoft.com/azure/frontdoor/) access logs** — filter by country, visitor, and URL path, and see *who used what*.

Front Door access logs carry no identity or geo fields, so FrontLens treats
`clientIp` as the subject and enriches it (country, city, ASN) at query time.
Every view is a shareable URL, every list exports to CSV, and the whole thing runs
on an in-memory mock data source out of the box — no database, no Azure account,
no setup.

Built with Next.js 16 (App Router), React 19, TanStack Query/Table/Virtual,
Recharts + ECharts, Tailwind v4, and zod. SSO via Microsoft Entra ID is optional.

## Highlights

- **Path explorer** — match by prefix, glob, or regex (`/api/*`, `^/v1/(quote|news)$`) and see the visitors behind each path.
- **Visitor view** — drill from an IP to its countries, paths, user agents, and request history.
- **Geography** — country and city breakdowns on an interactive world map.
- **Anomalies** — KPI-driven spike detection with one-click drill-down into the dimension that moved.
- **Logs** — a virtualized raw-log table with a detail inspector.
- **Demo / Live** — flip between deterministic synthetic data and real Front Door logs from the same UI.

## Architecture

```
Browser ──POST /api/query──▶ BFF route ──▶ DataSource ──▶ mock | Log Analytics | ClickHouse
  (react-query + nuqs URL state)   (auth + zod)   (one interface)
```

Three contracts keep the app small and swappable:

- **One filter model** ([lib/filters/model.ts](lib/filters/model.ts)) — a single zod
  schema is the source of truth for the UI, the URL (every view is a shareable
  link), the BFF, and each adapter. Mock matching semantics live in
  [lib/filters/match.ts](lib/filters/match.ts); the ClickHouse SQL compiler in
  [lib/datasource/clickhouse/sql.ts](lib/datasource/clickhouse/sql.ts) mirrors them.
- **One backend contract** ([lib/datasource/types.ts](lib/datasource/types.ts)) —
  swapping data sources touches only the factory
  ([lib/datasource/index.ts](lib/datasource/index.ts)); the UI never changes.
- **One BFF dispatcher** ([app/api/query/route.ts](app/api/query/route.ts)) — the
  browser never holds backend credentials, and all user input is parameterized.

## Quick start

```bash
npm install
npm run dev          # in-memory mock data source — no DB or cloud needed
```

Open http://localhost:3000.

## Data sources

FrontLens serves three data sources behind one interface, selected by
`AFD_DATASOURCE` and surfaced as a **Demo / Live** header toggle whenever more
than one is listed in `AFD_SOURCES`.

### Demo — `mock`

Deterministic in-memory data with realistic countries, paths, ASNs, and user
agents. The default; no dependencies.

### Live — `loganalytics`

Real Azure Front Door access logs queried straight from the Log Analytics
workspace your AFD diagnostic setting streams to. This adds **no extra database or
always-on compute** — only a read-only RBAC grant.

```bash
az login
LOG_ANALYTICS_WORKSPACE_ID=<workspace-guid> AFD_SOURCES=mock,loganalytics npm run dev
```

Need real data to look at? Drive some traffic at the Front Door endpoint that
streams to the workspace (varied paths, user-agents, and a few WAF-blocked probes
for status variety), then wait a few minutes for Log Analytics ingestion:

```bash
npm run gen:traffic -- --host <your-endpoint>.azurefd.net --count 1500
# --duration <sec> for continuous traffic · --no-waf to skip the WAF probes
```

The BFF picks the source per request from the toggle and always reports back the
source that actually served the data; if Live isn't configured it safely falls
back to Demo. In Azure, the app authenticates to Log Analytics with a
user-assigned managed identity (`AZURE_CLIENT_ID`) granted **Log Analytics
Reader** on the workspace. Because AFD logs carry no ASN, that column reads `—` in
Live mode; country, city, and coordinates come from KQL's `geo_info_from_ip_address`.

### ClickHouse — `clickhouse`

For high-volume, self-hosted ingestion.

```bash
npm run ch:up        # docker compose: local ClickHouse
npm run ch:load      # apply schema + rollups, insert ~200k synthetic rows
AFD_DATASOURCE=clickhouse CLICKHOUSE_PASSWORD=frontlens npm run dev
```

At high volume, `summary` / `timeseries` / `geo` automatically read the
pre-aggregated `afd.rollup_traffic_1m` rollup when the active filter allows it
(see [ingest/02_rollups.sql](ingest/02_rollups.sql)). Set `AFD_ROLLUPS=off` to
always read the raw table.

Copy [.env.example](.env.example) to `.env.local` for the full list of settings.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Dev server (mock data source by default) |
| `npm run build` | Production build (standalone output) |
| `npm run lint` | ESLint (flat config) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest (watch) |
| `npm run test:run` | Vitest (single run, CI) |
| `npm run check:sql` | No-DB validation of the ClickHouse SQL compiler |
| `npm run check:kql` | No-DB validation of the Log Analytics KQL compiler |

## Testing

Unit/integration tests run with [Vitest](https://vitest.dev) and need no database
(the mock data source is deterministic). Coverage spans the filter model
(URL round-trips), mock matching (path/CIDR/status/search), CSV export escaping,
the ClickHouse SQL compiler, and the mock `DataSource` contract.

```bash
npm run test:run
```

## Deployment

`output: "standalone"` produces a self-contained server bundle, and the
[Dockerfile](Dockerfile) builds a minimal image for Azure Container Apps. Two
Bicep stacks under [infra/](infra/) provision everything:

- [infra/main.bicep](infra/main.bicep) — the FrontLens app (Container Apps env,
  ACR, managed identity, Log Analytics, and the container app itself).
- [infra/afd-e2e.bicep](infra/afd-e2e.bicep) — an optional, self-contained Azure
  Front Door (Premium) + WAF + origin that streams real access/WAF logs to Log
  Analytics, for exercising Live mode end-to-end.

See **[AZURE.md](AZURE.md)** for the full step-by-step deployment, Live-mode
wiring, and teardown commands.
