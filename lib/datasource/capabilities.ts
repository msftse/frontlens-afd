import type { Dimension } from "@/lib/domain/types";
import type { SourceKind } from "@/lib/datasource";

/**
 * Per-source dimension capabilities.
 *
 * Not every dimension is backed by real data on every source. Azure Front Door
 * access logs (the `loganalytics` source) carry NO ASN/ASN-org, NO parsed
 * user-agent family/OS, and NO city until we run a geo lookup. The mock and
 * ClickHouse sources enrich those at ingestion, so they're real there.
 *
 * Rather than fabricate values, the UI consults this map and HIDES the
 * unsupported breakdowns (with an honest note) on sources that can't back them.
 * This is intentionally client-side and declarative: it is the single source of
 * truth for "what's real where", used by the Anomalies board and anywhere else
 * that pivots by dimension.
 */

/** Dimensions that are NOT real on Azure Front Door access logs. */
const LOG_ANALYTICS_UNSUPPORTED: readonly Dimension[] = [
  "asnOrg", // AFD logs have no ASN; adapter returns a constant "-"
  "uaFamily", // AFD logs carry the raw UA only; no parsed family
  // `city` IS derivable via geo_info_from_ip_address(), but only on the geo /
  // visitor views that opt into the per-row cost, so it is not offered as a
  // general breakdown dimension on Live.
  "city",
];

/** Human-readable reason a dimension is hidden on a given source. */
export const UNSUPPORTED_REASON: Partial<Record<Dimension, string>> = {
  asnOrg: "Front Door access logs don't include ASN / network",
  uaFamily: "Front Door access logs include only the raw user agent",
  city: "City needs a geo lookup and isn't available as a Live breakdown",
};

const UNSUPPORTED_BY_SOURCE: Record<SourceKind, ReadonlySet<Dimension>> = {
  loganalytics: new Set(LOG_ANALYTICS_UNSUPPORTED),
  clickhouse: new Set<Dimension>(),
  mock: new Set<Dimension>(),
};

/**
 * Coerce an arbitrary reported source string to a known {@link SourceKind}.
 * Unknown / null sources are treated as the fully-featured mock so the UI never
 * hides a real dimension by accident (fail open on capability, not on data).
 */
export function toSourceKind(name: string | null | undefined): SourceKind {
  if (name === "loganalytics" || name === "clickhouse" || name === "mock") return name;
  return "mock";
}

/** Whether `dim` is backed by real data on `source`. */
export function isDimensionSupported(source: SourceKind, dim: Dimension): boolean {
  return !UNSUPPORTED_BY_SOURCE[source].has(dim);
}

/**
 * Whether a source exposes Web Application Firewall logs. Front Door (Log
 * Analytics) and the mock do; the ClickHouse traffic pipeline does not, so WAF
 * features are hidden there rather than shown empty.
 */
const WAF_SOURCES: ReadonlySet<SourceKind> = new Set<SourceKind>(["loganalytics", "mock"]);
export function isWafSupported(source: SourceKind): boolean {
  return WAF_SOURCES.has(source);
}

/** Partition dimensions into the ones a source can back and the ones it can't. */
export function partitionDimensions<T extends { dimension: Dimension }>(
  source: SourceKind,
  dims: readonly T[],
): { supported: T[]; hidden: T[] } {
  const supported: T[] = [];
  const hidden: T[] = [];
  for (const d of dims) {
    if (isDimensionSupported(source, d.dimension)) supported.push(d);
    else hidden.push(d);
  }
  return { supported, hidden };
}
