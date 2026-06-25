import type { Dimension, Summary, TimePoint } from "@/lib/domain/types";
import type { Filter } from "@/lib/filters/model";
import type { TopNOptions } from "@/lib/datasource/types";
import { fmtDelta } from "@/lib/format";

/**
 * Anomaly model for the eight Overview KPIs. Detection is intentionally simple
 * and client-side:
 *
 *   1. Period-over-period — flag a KPI when its `summary.delta` (relative change
 *      vs the previous equal-length window) breaches a per-metric threshold.
 *   2. In-window spikes — a robust median/MAD outlier pass over the existing
 *      timeseries marks *when* it happened (for the trend highlight + zoom).
 *
 * No backend is involved: every input here already comes from `/api/query`.
 */

export type MetricKey =
  | "requests"
  | "uniqueVisitors"
  | "bytes"
  | "cacheHitRatio"
  | "errorRate4xx"
  | "errorRate5xx"
  | "p95LatencyMs"
  | "avgLatencyMs";

interface MetricConfig {
  key: MetricKey;
  label: string;
  /** Whether a rise is the healthy direction (requests, cache hit) vs. a regression (errors, latency). */
  goodWhenUp: boolean;
  /** |relative delta| at/above which the metric is flagged anomalous. */
  relThreshold: number;
  /** Rate metrics only: suppress the flag unless the current value reaches this floor (kills noise on tiny values). */
  absFloor?: number;
}

/** The eight KPIs, in the order they appear on the Overview grid. */
export const METRIC_CONFIG: readonly MetricConfig[] = [
  { key: "requests", label: "Requests", goodWhenUp: true, relThreshold: 0.3 },
  { key: "uniqueVisitors", label: "Unique visitors", goodWhenUp: true, relThreshold: 0.3 },
  { key: "bytes", label: "Data transferred", goodWhenUp: true, relThreshold: 0.35 },
  { key: "cacheHitRatio", label: "Cache hit ratio", goodWhenUp: true, relThreshold: 0.15 },
  { key: "errorRate4xx", label: "4xx rate", goodWhenUp: false, relThreshold: 0.5, absFloor: 0.02 },
  { key: "errorRate5xx", label: "5xx rate", goodWhenUp: false, relThreshold: 0.5, absFloor: 0.005 },
  { key: "p95LatencyMs", label: "p95 latency", goodWhenUp: false, relThreshold: 0.25 },
  { key: "avgLatencyMs", label: "Avg latency", goodWhenUp: false, relThreshold: 0.25 },
];

export interface MetricAnomaly {
  key: MetricKey;
  label: string;
  value: number;
  /** Relative change vs the previous window (e.g. 0.5 = +50%); undefined if unknown. */
  delta?: number;
  direction: "up" | "down" | "flat";
  anomalous: boolean;
  /** 0..1 magnitude relative to the metric's threshold — used to rank the worst mover. */
  severity: number;
  goodWhenUp: boolean;
  /** Plain-language one-liner for the card / header. */
  text: string;
}

/** Score all eight KPIs from a summary (which carries the period-over-period deltas). */
export function scoreMetricAnomaly(summary: Summary | undefined): MetricAnomaly[] {
  if (!summary) return [];
  return METRIC_CONFIG.map((c) => {
    const value = (summary[c.key] as number | undefined) ?? 0;
    const delta = summary.delta?.[c.key];
    const { dir } = fmtDelta(delta);
    const mag = delta === undefined ? 0 : Math.abs(delta);
    const passesFloor = c.absFloor === undefined || value >= c.absFloor;
    const anomalous = mag >= c.relThreshold && passesFloor && dir !== "flat";
    const severity = Math.min(1, mag / (c.relThreshold * 2));
    return {
      key: c.key,
      label: c.label,
      value,
      delta,
      direction: dir,
      anomalous,
      severity,
      goodWhenUp: c.goodWhenUp,
      text:
        delta === undefined || dir === "flat"
          ? `${c.label} is steady vs the previous period.`
          : `${c.label} is ${fmtDelta(delta).text} vs the previous period.`,
    };
  });
}

/** The metric worth showing first: worst anomaly, else the largest mover. */
export function worstAnomaly(list: MetricAnomaly[]): MetricKey | undefined {
  if (!list.length) return undefined;
  const anomalous = list.filter((m) => m.anomalous);
  const pool = anomalous.length ? anomalous : list;
  return pool.reduce((a, b) => (b.severity > a.severity ? b : a)).key;
}

// ---------------------------------------------------------------------------
// Per-bucket series extraction + spike detection
// ---------------------------------------------------------------------------

/**
 * Project a metric out of the timeseries buckets, preserving `points` order so
 * callers can zip the result back with each bucket's timestamp. Note: the
 * timeseries has no per-bucket p95, so both latency metrics use `avgLatencyMs`.
 */
export function seriesFor(points: TimePoint[], key: MetricKey): number[] {
  return points.map((p) => valueFromPoint(p, key));
}

function valueFromPoint(p: TimePoint, key: MetricKey): number {
  switch (key) {
    case "requests":
      return p.requests;
    case "uniqueVisitors":
      return p.uniqueVisitors;
    case "bytes":
      return p.bytes;
    case "cacheHitRatio": {
      const considered = p.cacheHit + p.cacheMiss;
      return considered ? p.cacheHit / considered : 0;
    }
    case "errorRate4xx":
      return p.requests ? p.status4xx / p.requests : 0;
    case "errorRate5xx":
      return p.requests ? p.status5xx / p.requests : 0;
    case "p95LatencyMs":
    case "avgLatencyMs":
      return p.avgLatencyMs;
  }
}

export interface SpikeResult {
  /** Indices of outlier buckets (into the `values`/`points` array). */
  idxs: number[];
  /** Inclusive bounding window over the outliers, for "zoom to spike". */
  window?: { startIdx: number; endIdx: number };
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Robust outlier detection via median + MAD (median absolute deviation): flags
 * buckets whose modified z-score is at/above `k`. Falls back to mean/σ when the
 * MAD is zero (a flat series with a few jumps). Needs >= 4 points.
 */
export function detectSpikes(values: number[], k = 3.5): SpikeResult {
  const n = values.length;
  if (n < 4) return { idxs: [] };

  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med)));
  const idxs: number[] = [];

  if (mad > 0) {
    const scale = 1.4826 * mad;
    values.forEach((v, i) => {
      if (Math.abs(v - med) / scale >= k) idxs.push(i);
    });
  } else {
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    if (sd === 0) return { idxs: [] };
    values.forEach((v, i) => {
      if (Math.abs(v - mean) / sd >= k) idxs.push(i);
    });
  }

  if (!idxs.length) return { idxs: [] };
  return { idxs, window: { startIdx: Math.min(...idxs), endIdx: Math.max(...idxs) } };
}

// ---------------------------------------------------------------------------
// Per-metric drill-down breakdown configuration ("what's driving it")
// ---------------------------------------------------------------------------

export interface BreakdownDim {
  /** A Top-N dimension. `path` may be served via the Path Explorer resource. */
  dimension: Dimension;
  label: string;
  sortBy?: NonNullable<TopNOptions["sortBy"]>;
}

export interface MetricBreakdown {
  /** Transient scope applied to breakdown queries only (e.g. status:5xx), never persisted. */
  prefilter?: Partial<Filter>;
  dims: BreakdownDim[];
}

/** Which dimensions decompose each KPI, and how to pre-scope + rank them. */
export const BREAKDOWNS: Record<MetricKey, MetricBreakdown> = {
  requests: {
    dims: [
      { dimension: "path", label: "Top paths", sortBy: "requests" },
      { dimension: "country", label: "Countries", sortBy: "requests" },
      { dimension: "clientIp", label: "Client IPs", sortBy: "requests" },
      { dimension: "asnOrg", label: "Networks", sortBy: "requests" },
      { dimension: "uaFamily", label: "User agents", sortBy: "requests" },
    ],
  },
  uniqueVisitors: {
    dims: [
      { dimension: "country", label: "Countries", sortBy: "uniqueVisitors" },
      { dimension: "asnOrg", label: "Networks", sortBy: "uniqueVisitors" },
      { dimension: "clientIp", label: "Client IPs", sortBy: "uniqueVisitors" },
      { dimension: "uaFamily", label: "User agents", sortBy: "uniqueVisitors" },
      { dimension: "deviceType", label: "Device types", sortBy: "uniqueVisitors" },
    ],
  },
  bytes: {
    dims: [
      { dimension: "path", label: "Top paths", sortBy: "bytes" },
      { dimension: "clientIp", label: "Client IPs", sortBy: "bytes" },
      { dimension: "country", label: "Countries", sortBy: "bytes" },
      { dimension: "asnOrg", label: "Networks", sortBy: "bytes" },
    ],
  },
  cacheHitRatio: {
    prefilter: { cacheStatus: ["MISS"] },
    dims: [
      { dimension: "path", label: "Most-missed paths", sortBy: "requests" },
      { dimension: "host", label: "Hosts", sortBy: "requests" },
      { dimension: "cacheStatus", label: "Cache status", sortBy: "requests" },
      { dimension: "pop", label: "Edge POPs", sortBy: "requests" },
    ],
  },
  errorRate4xx: {
    prefilter: { status: ["4xx"] },
    dims: [
      { dimension: "path", label: "Failing paths", sortBy: "requests" },
      { dimension: "status", label: "Status codes", sortBy: "requests" },
      { dimension: "clientIp", label: "Client IPs", sortBy: "requests" },
      { dimension: "country", label: "Countries", sortBy: "requests" },
      { dimension: "uaFamily", label: "User agents", sortBy: "requests" },
    ],
  },
  errorRate5xx: {
    prefilter: { status: ["5xx"] },
    dims: [
      { dimension: "path", label: "Failing paths", sortBy: "requests" },
      { dimension: "status", label: "Status codes", sortBy: "requests" },
      { dimension: "host", label: "Hosts", sortBy: "requests" },
      { dimension: "pop", label: "Edge POPs", sortBy: "requests" },
      { dimension: "errorInfo", label: "Error reasons", sortBy: "requests" },
    ],
  },
  p95LatencyMs: {
    dims: [
      { dimension: "path", label: "Slowest paths", sortBy: "requests" },
      { dimension: "pop", label: "Edge POPs", sortBy: "requests" },
      { dimension: "country", label: "Countries", sortBy: "requests" },
      { dimension: "host", label: "Hosts", sortBy: "requests" },
    ],
  },
  avgLatencyMs: {
    dims: [
      { dimension: "path", label: "Slowest paths", sortBy: "requests" },
      { dimension: "pop", label: "Edge POPs", sortBy: "requests" },
      { dimension: "country", label: "Countries", sortBy: "requests" },
      { dimension: "host", label: "Hosts", sortBy: "requests" },
    ],
  },
};
