import "server-only";

import type { DataSource } from "@/lib/datasource/types";
import { MockDataSource } from "@/lib/datasource/mock";
import { ClickHouseDataSource } from "@/lib/datasource/clickhouse";
import { LogAnalyticsDataSource } from "@/lib/datasource/loganalytics";

/**
 * Data-source registry. FrontLens can serve more than one backend from a single
 * deployment ("demo" mock + a real source), and the BFF picks per request, so
 * instances are cached PER KIND rather than as a single global singleton.
 *
 *  - `mock`         - in-memory synthetic generator (always available).
 *  - `loganalytics` - live Azure Front Door logs via Log Analytics (Kusto).
 *  - `clickhouse`   - columnar backend (Phase 2 / high volume).
 *
 * Which kinds are *selectable* at runtime is controlled by `AFD_SOURCES`
 * (comma list, default "mock"). `AFD_DATASOURCE` names the default kind.
 */
export type SourceKind = "mock" | "loganalytics" | "clickhouse";

const KNOWN: readonly SourceKind[] = ["mock", "loganalytics", "clickhouse"] as const;

function isKnown(v: string): v is SourceKind {
  return (KNOWN as readonly string[]).includes(v);
}

/**
 * Whether a kind is actually usable in this environment. `mock` always is;
 * `loganalytics` needs a workspace id; `clickhouse` needs a URL. Keeps the UI
 * toggle honest and lets the BFF fall back instead of 500-ing on a misconfig.
 */
function isConfigured(kind: SourceKind): boolean {
  switch (kind) {
    case "loganalytics":
      return !!process.env.LOG_ANALYTICS_WORKSPACE_ID;
    case "clickhouse":
      return !!process.env.CLICKHOUSE_URL;
    case "mock":
      return true;
  }
}

/** Construct the data source for a kind. */
function create(kind: SourceKind): DataSource {
  switch (kind) {
    case "loganalytics":
      return new LogAnalyticsDataSource();
    case "clickhouse":
      return new ClickHouseDataSource();
    case "mock":
    default:
      return new MockDataSource();
  }
}

const instances = new Map<SourceKind, DataSource>();

/**
 * Return the data source for `kind` (defaults to the configured default). Cached
 * per kind so the mock's one-time dataset generation and the ClickHouse/LA
 * clients are reused across requests.
 */
export function getDataSource(kind?: SourceKind): DataSource {
  const k = kind ?? defaultSourceKind();
  let ds = instances.get(k);
  if (!ds) {
    ds = create(k);
    instances.set(k, ds);
  }
  return ds;
}

/** The active default data source's name (cheap, no I/O). */
export function dataSourceName(): string {
  return defaultSourceKind();
}

/** The default kind from `AFD_DATASOURCE` (falls back to "mock"). */
export function defaultSourceKind(): SourceKind {
  const v = (process.env.AFD_DATASOURCE ?? "").trim();
  return isKnown(v) ? v : "mock";
}

/**
 * The kinds selectable at runtime. Always includes the default. Parsed from
 * `AFD_SOURCES` (comma list); unknown or unconfigured entries are dropped.
 * "mock" is always available as a safe fallback.
 */
export function availableSourceKinds(): SourceKind[] {
  const set = new Set<SourceKind>(["mock"]);
  const def = defaultSourceKind();
  if (isConfigured(def)) set.add(def);
  for (const raw of (process.env.AFD_SOURCES ?? "").split(",")) {
    const v = raw.trim();
    if (v && isKnown(v) && isConfigured(v)) set.add(v);
  }
  // Preserve a stable, friendly order.
  return KNOWN.filter((k) => set.has(k));
}

/**
 * Resolve a requested source name (from the UI toggle / BFF body) to a concrete,
 * *allowed* kind. Falls back to the default (or mock if the default itself is
 * unconfigured) when the request is missing, unknown, not in the allowlist, or
 * not configured - so a response always truthfully reports the source that
 * actually served it, instead of 500-ing on a misconfiguration.
 */
export function resolveSourceKind(requested?: string | null): SourceKind {
  const available = availableSourceKinds();
  const fallback: SourceKind = available.includes(defaultSourceKind())
    ? defaultSourceKind()
    : "mock";
  if (!requested) return fallback;
  const v = requested.trim();
  if (isKnown(v) && available.includes(v)) return v;
  return fallback;
}
