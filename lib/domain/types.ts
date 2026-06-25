/**
 * Canonical domain model for the AFD analytics GUI.
 *
 * `AccessLogRecord` mirrors the Azure Front Door Standard/Premium *access log*
 * schema (table `AFDAccessLog`) plus the enrichment we add ourselves, because
 * AFD logs contain NO country/city/ASN field and NO user identity - those are
 * derived from `clientIp` via geo-IP/ASN lookup at ingestion time.
 *
 * Every data source (mock, ClickHouse, Log Analytics) returns this exact shape.
 */

export type Protocol = "HTTP" | "HTTPS" | "WS" | "WSS";

export type DeviceType = "desktop" | "mobile" | "tablet" | "bot";

/** Azure Front Door cache status values (CacheStatus field). */
export type CacheStatus =
  | "HIT"
  | "REMOTE_HIT"
  | "PARTIAL_HIT"
  | "MISS"
  | "CACHE_NOCONFIG"
  | "PRIVATE_NOSTORE"
  | "N/A";

export interface AccessLogRecord {
  /** Unique reference (X-Azure-Ref) - joins AFD logs to app logs. */
  trackingRef: string;
  /** Event time (ISO-8601, UTC). */
  timestamp: string;

  // ---- Request line ----
  method: string; // GET, POST, ...
  httpVersion: string; // "2.0", "1.1"
  scheme: "http" | "https";
  host: string; // HostName, e.g. "nadav.com"
  path: string; // pathname only, e.g. "/api/v1/quote"
  query: string; // raw query string without leading "?"
  url: string; // full RequestUri

  // ---- Response ----
  status: number; // HttpStatusCode (0 = origin timeout, 499 = client closed)
  protocol: Protocol; // RequestProtocol
  requestBytes: number;
  responseBytes: number;
  timeTaken: number; // seconds, edge received -> last byte to client
  timeToFirstByte: number; // seconds

  // ---- The "who" (client) ----
  clientIp: string; // ClientIp (from X-Forwarded-For)
  socketIp: string; // SocketIp (direct connection / proxy)
  clientPort: number;

  // ---- Enrichment of clientIp (added by us; NOT in raw AFD logs) ----
  country: string; // ISO-3166 alpha-2, e.g. "US"
  countryName: string;
  city: string;
  latitude: number;
  longitude: number;
  asn: number; // autonomous system number
  asnOrg: string; // organization / ISP name

  // ---- Client fingerprint ----
  userAgent: string;
  uaFamily: string; // "Chrome", "Safari", "curl", "Googlebot"
  uaOs: string; // "Windows", "iOS", ...
  deviceType: DeviceType;
  ja4: string; // TLS Client Hello fingerprint (SslJA4)
  referer: string;

  // ---- Edge / routing ----
  endpoint: string; // AFD endpoint domain
  pop: string; // edge Point of Presence code, e.g. "LAX"
  cacheStatus: CacheStatus;
  routeName: string;
  ruleSetName: string;
  securityProtocol: string; // TLSv1.2, TLSv1.3, ...
  errorInfo: string; // NoError, OriginTimeout, ...

  // ---- Origin ----
  originName: string;
  originStatus: number;
}

/** Dimensions that can be grouped / pivoted / used in Top-N. */
export type Dimension =
  | "country"
  | "city"
  | "asnOrg"
  | "clientIp"
  | "host"
  | "path"
  | "status"
  | "statusClass"
  | "method"
  | "uaFamily"
  | "deviceType"
  | "pop"
  | "cacheStatus"
  | "referer"
  | "ja4"
  | "errorInfo";

export type StatusClass = "2xx" | "3xx" | "4xx" | "5xx" | "other";

// ----------------------------------------------------------------------------
// Aggregation result shapes
// ----------------------------------------------------------------------------

export interface Summary {
  requests: number;
  uniqueVisitors: number; // distinct clientIp
  bytes: number; // total responseBytes (edge -> client)
  cacheHitRatio: number; // 0..1
  errorRate4xx: number; // 0..1
  errorRate5xx: number; // 0..1
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  /** Comparison vs the immediately preceding equal-length window (ratios). */
  delta?: Partial<Record<keyof Omit<Summary, "delta">, number>>;
}

export interface TimePoint {
  /** Bucket start (ISO-8601). */
  t: string;
  requests: number;
  uniqueVisitors: number;
  bytes: number;
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
  cacheHit: number;
  cacheMiss: number;
  avgLatencyMs: number;
}

export interface TopNRow {
  key: string; // dimension value
  label: string; // display label
  requests: number;
  uniqueVisitors: number;
  bytes: number;
  errorRate: number; // 0..1 (4xx+5xx)
  cacheHitRatio: number; // 0..1
  share: number; // fraction of total requests (0..1)
}

export interface GeoRow {
  country: string; // ISO-2
  countryName: string;
  requests: number;
  uniqueVisitors: number;
  bytes: number;
  errorRate: number;
  cacheHitRatio: number;
  share: number;
}

/** One row of the Path Explorer. */
export interface PathRow {
  host: string;
  path: string;
  requests: number;
  uniqueVisitors: number;
  bytes: number;
  errorRate: number;
  cacheHitRatio: number;
  avgLatencyMs: number;
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
  share: number;
  lastSeen: string;
}

/** A visitor (client IP) - the "who". */
export interface VisitorRow {
  clientIp: string;
  country: string;
  countryName: string;
  city: string;
  asn: number;
  asnOrg: string;
  uaFamily: string;
  deviceType: DeviceType;
  ja4: string;
  requests: number;
  bytes: number;
  distinctPaths: number;
  errorRate: number;
  firstSeen: string;
  lastSeen: string;
}

export interface VisitorDetail {
  visitor: VisitorRow;
  topPaths: TopNRow[];
  statusBreakdown: { key: StatusClass; requests: number }[];
  pops: TopNRow[];
  userAgents: TopNRow[];
  timeline: TimePoint[];
  recent: AccessLogRecord[];
}

export interface LogsPage {
  rows: AccessLogRecord[];
  total: number;
  /** Opaque cursor for next page (index-based for mock). */
  nextCursor: string | null;
}

export const STATUS_CLASSES: StatusClass[] = ["2xx", "3xx", "4xx", "5xx", "other"];

export function statusClass(status: number): StatusClass {
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 300 && status < 400) return "3xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500 && status < 600) return "5xx";
  return "other";
}
