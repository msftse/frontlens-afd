import type {
  Dimension,
  GeoRow,
  LogsPage,
  PathRow,
  ProxyChains,
  Summary,
  TimePoint,
  TopNRow,
  VisitorDetail,
  VisitorRow,
} from "@/lib/domain/types";
import type { Filter } from "@/lib/filters/model";

export type SortDir = "asc" | "desc";

export interface TopNOptions {
  dimension: Dimension;
  limit?: number;
  sortBy?: "requests" | "uniqueVisitors" | "bytes" | "errorRate";
  sortDir?: SortDir;
}

export interface TimeseriesOptions {
  /** Bucket size in seconds. If omitted, chosen automatically from the range. */
  bucketSeconds?: number;
}

export interface PathExplorerOptions {
  limit?: number;
  offset?: number;
  sortBy?: "requests" | "uniqueVisitors" | "bytes" | "errorRate" | "avgLatencyMs";
  sortDir?: SortDir;
  /** Group sub-paths up to this depth (e.g. 2 => /api/v1). 0 = full path. */
  depth?: number;
}

export interface VisitorsOptions {
  limit?: number;
  offset?: number;
  sortBy?: "requests" | "bytes" | "distinctPaths" | "errorRate" | "lastSeen";
  sortDir?: SortDir;
}

export interface LogsOptions {
  limit?: number;
  cursor?: string | null;
  sortDir?: SortDir; // by timestamp
}

/**
 * The single contract every backend implements. The UI never imports a concrete
 * source, only this interface, so swapping mock → ClickHouse → Log Analytics
 * touches one factory.
 */
export interface DataSource {
  readonly name: string;

  /** KPI headline numbers (+ deltas vs previous window). */
  summary(filter: Filter): Promise<Summary>;

  /** Time-bucketed series for trend charts. */
  timeseries(filter: Filter, opts?: TimeseriesOptions): Promise<TimePoint[]>;

  /** Top-N breakdown by an arbitrary dimension. */
  topN(filter: Filter, opts: TopNOptions): Promise<TopNRow[]>;

  /** Per-country aggregation for the geography view + map. */
  geo(filter: Filter): Promise<GeoRow[]>;

  /** Path Explorer: aggregate by host+path (the headline feature). */
  paths(filter: Filter, opts?: PathExplorerOptions): Promise<{ rows: PathRow[]; total: number }>;

  /** "Who hit this path" - visitors for a given host+path under the filter. */
  pathVisitors(
    filter: Filter,
    host: string,
    path: string,
    opts?: VisitorsOptions,
  ): Promise<{ rows: VisitorRow[]; total: number }>;

  /** Visitors ("who") aggregated by client IP. */
  visitors(filter: Filter, opts?: VisitorsOptions): Promise<{ rows: VisitorRow[]; total: number }>;

  /** Full drill-down for a single visitor (client IP). */
  visitorDetail(filter: Filter, clientIp: string): Promise<VisitorDetail | null>;

  /** Raw access-log rows (virtualized grid), newest first. */
  logs(filter: Filter, opts?: LogsOptions): Promise<LogsPage>;

  /** Proxy-chain analysis: traffic where SocketIp differs from ClientIp. */
  proxyChains(filter: Filter, limit?: number): Promise<ProxyChains>;

  /** Distinct values for a dimension (for filter autocomplete). */
  facetValues(filter: Filter, dimension: Dimension, limit?: number): Promise<TopNRow[]>;
}
