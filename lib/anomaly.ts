import type { Dimension, Summary, TimePoint } from "@/lib/domain/types";
import type { Filter } from "@/lib/filters/model";
import type { TopNOptions } from "@/lib/datasource/types";
import { fmtDelta } from "@/lib/format";

/**
 * Anomaly model for the eight Overview KPIs. Detection is intentionally simple
 * and client-side:
 *
 *   1. Period-over-period - flag a KPI when its `summary.delta` (relative change
 *      vs the previous equal-length window) breaches a per-metric threshold.
 *   2. In-window spikes - a robust median/MAD outlier pass over the existing
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
  /** 0..1 magnitude relative to the metric's threshold - used to rank the worst mover. */
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
 * callers can zip the result back with each bucket's timestamp. Latency metrics
 * read their own per-bucket aggregate (`p95LatencyMs` / `avgLatencyMs`).
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
      return p.p95LatencyMs;
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
// Incident engine: rolling baseline -> per-bucket score -> grouped incidents
// ---------------------------------------------------------------------------
//
// Where `detectSpikes` answers "which buckets are outliers" over a whole
// series, the incident engine answers "what discrete events happened, when,
// how bad, and in the direction that matters for this metric". It powers the
// Overview/Anomalies incident feed and timeline strip.
//
// It is a pure function of the timeseries the datasource already returns, so it
// runs identically against real AFD (Log Analytics), ClickHouse and mock data.

/** Per-bucket robust baseline: a local center (median) and scale (MAD->sigma). */
export interface BaselinePoint {
  center: number;
  /** Robust standard-deviation estimate (1.4826 * MAD), floored to avoid /0. */
  scale: number;
}

const MAD_TO_SIGMA = 1.4826;

/**
 * Rolling robust baseline over `values`. For each index we take a *trailing*
 * window of up to `window` prior buckets (excluding the current one) and derive
 * a median center and MAD-based scale. Trailing (not centered) so an event does
 * not mask itself; falls back to the global center/scale until enough history
 * exists. When MAD is zero (a flat stretch) we fall back to the window's stdev,
 * then to a small fraction of the center, so a jump off a perfectly flat line
 * still scores.
 */
export function rollingBaseline(values: number[], window = 24): BaselinePoint[] {
  const n = values.length;
  if (n === 0) return [];
  const globalMed = median(values);
  const globalMad = median(values.map((v) => Math.abs(v - globalMed)));
  const globalScale = robustScale(values, globalMed, globalMad);

  const out: BaselinePoint[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - window);
    const hist = values.slice(start, i);
    if (hist.length < 4) {
      out.push({ center: globalMed, scale: globalScale });
      continue;
    }
    const med = median(hist);
    const mad = median(hist.map((v) => Math.abs(v - med)));
    out.push({ center: med, scale: robustScale(hist, med, mad) });
  }
  return out;
}

/** MAD->sigma, with a stdev fallback for flat windows and a floor off center. */
function robustScale(sample: number[], center: number, mad: number): number {
  if (mad > 0) return MAD_TO_SIGMA * mad;
  if (sample.length > 1) {
    const mean = sample.reduce((a, b) => a + b, 0) / sample.length;
    const sd = Math.sqrt(sample.reduce((a, b) => a + (b - mean) ** 2, 0) / sample.length);
    if (sd > 0) return sd;
  }
  // Perfectly flat history: allow a jump to still register (5% of |center|).
  return Math.max(Math.abs(center) * 0.05, Number.EPSILON);
}

/** Signed modified z-score of each bucket against its rolling baseline. */
export function bucketScores(values: number[], window = 24): number[] {
  const base = rollingBaseline(values, window);
  return values.map((v, i) => (v - base[i].center) / base[i].scale);
}

/**
 * Contamination-resistant scores. A plain trailing baseline is poisoned by the
 * event itself: once a sustained anomaly enters the trailing window, it lifts
 * the center/scale and the rest of the event scores as "normal". We fix that by
 * winsorizing: after a first pass flags hot buckets against `k`, we replace each
 * hot bucket's value with its baseline center and recompute, so the baseline
 * reflects *normal* traffic only. Two passes converge in practice; we cap at 3.
 * Returns the final signed scores and the value series actually used as the
 * baseline reference (hot buckets held at normal).
 */
function robustScores(
  values: number[],
  window: number,
  k: number,
  badIsUp: boolean,
): { scores: number[]; baseline: BaselinePoint[] } {
  let ref = values;
  let base = rollingBaseline(ref, window);
  let scores = values.map((v, i) => (v - base[i].center) / base[i].scale);

  for (let pass = 0; pass < 3; pass++) {
    const hot = scores.map((s) => (badIsUp ? s >= k : s <= -k));
    if (!hot.some(Boolean)) break;
    // Hold hot buckets at their current baseline center for the next baseline.
    const nextRef = values.map((v, i) => (hot[i] ? base[i].center : v));
    if (arraysEqual(nextRef, ref)) break;
    ref = nextRef;
    base = rollingBaseline(ref, window);
    // Score the ORIGINAL values against the clean baseline.
    scores = values.map((v, i) => (v - base[i].center) / base[i].scale);
  }
  return { scores, baseline: base };
}

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** A detected incident on one metric: a contiguous run of anomalous buckets. */
export interface Incident {
  metric: MetricKey;
  label: string;
  /** Inclusive bucket index bounds into the source `points` array. */
  startIdx: number;
  endIdx: number;
  /** ISO timestamps of the first and last anomalous bucket. */
  startTime: string;
  endTime: string;
  /** Number of buckets in the incident (>= 1). */
  buckets: number;
  /** Whether the metric moved in its unhealthy direction. */
  direction: "up" | "down";
  /** Peak observed value within the incident. */
  peakValue: number;
  /** Baseline center at the peak bucket (what "normal" looked like). */
  baselineAtPeak: number;
  /** Peak |modified z-score| across the incident (how far from normal). */
  peakScore: number;
  /** 0..1 rank across incidents: folds peak deviation and duration together. */
  severity: number;
}

export interface DetectIncidentsOptions {
  /** |modified z-score| at/above which a bucket is anomalous. Default 3.5. */
  k?: number;
  /** Trailing baseline window in buckets. Default 24. */
  window?: number;
  /** Bridge this many sub-threshold buckets between spikes into one incident. Default 1. */
  maxGap?: number;
  /** Ignore incidents shorter than this many buckets. Default 1. */
  minBuckets?: number;
}

/**
 * Detect incidents for one metric across the timeseries. A bucket qualifies
 * when its signed score crosses `k` in the metric's *unhealthy* direction
 * (rise for errors/latency, drop for requests/cache-hit per METRIC_CONFIG),
 * and, for rate metrics, only once the value clears the metric's `absFloor`.
 * Consecutive qualifying buckets (allowing `maxGap` quiet buckets between) form
 * one incident. Returns incidents sorted by descending severity.
 */
export function detectIncidents(
  points: TimePoint[],
  key: MetricKey,
  opts: DetectIncidentsOptions = {},
): Incident[] {
  const cfg = METRIC_CONFIG.find((c) => c.key === key);
  if (!cfg) return [];
  const { k = 3.5, window = 24, maxGap = 1, minBuckets = 1 } = opts;
  const values = seriesFor(points, key);
  const n = values.length;
  if (n < 4) return [];

  const badIsUp = !cfg.goodWhenUp;
  const { scores, baseline: base } = robustScores(values, window, k, badIsUp);

  // A bucket is "hot" when it breaches k in the unhealthy direction and, for
  // floored rate metrics, is above the floor (kills noise on tiny values).
  const hot = values.map((v, i) => {
    const s = scores[i];
    const dirHit = badIsUp ? s >= k : s <= -k;
    const floorOk = cfg.absFloor === undefined || v >= cfg.absFloor;
    return dirHit && floorOk;
  });

  const incidents: Incident[] = [];
  let i = 0;
  while (i < n) {
    if (!hot[i]) {
      i++;
      continue;
    }
    // Extend the run, bridging up to `maxGap` non-hot buckets.
    let end = i;
    let gap = 0;
    for (let j = i + 1; j < n; j++) {
      if (hot[j]) {
        end = j;
        gap = 0;
      } else if (gap < maxGap) {
        gap++;
      } else {
        break;
      }
    }

    const incident = summarizeRun(points, values, base, scores, key, cfg.label, badIsUp, i, end);
    if (incident.buckets >= minBuckets) incidents.push(incident);
    i = end + 1;
  }

  rankIncidents(incidents);
  return incidents.sort((a, b) => b.severity - a.severity);
}

/** Build an Incident from an [start,end] run; picks the peak bucket by |score|. */
function summarizeRun(
  points: TimePoint[],
  values: number[],
  base: BaselinePoint[],
  scores: number[],
  key: MetricKey,
  label: string,
  badIsUp: boolean,
  start: number,
  end: number,
): Incident {
  let peakIdx = start;
  for (let j = start; j <= end; j++) {
    if (Math.abs(scores[j]) > Math.abs(scores[peakIdx])) peakIdx = j;
  }
  return {
    metric: key,
    label,
    startIdx: start,
    endIdx: end,
    startTime: points[start].t,
    endTime: points[end].t,
    buckets: end - start + 1,
    direction: badIsUp ? "up" : "down",
    peakValue: values[peakIdx],
    baselineAtPeak: base[peakIdx].center,
    peakScore: Math.abs(scores[peakIdx]),
    severity: 0, // filled by rankIncidents once the whole set is known
  };
}

/**
 * Assign each incident a 0..1 severity from three interpretable signals:
 *   - statistical deviation: |peak z-score| saturating around 8 sigma;
 *   - magnitude: fractional change of the peak vs its baseline (|peak-base|/base,
 *     capped at 1) so a collapse to ~0 (or a multi-fold spike) outranks a mild
 *     move even when both are many sigma out;
 *   - duration: a mild bonus so sustained events edge out equally-severe blips.
 * Weighted so magnitude and deviation dominate; result clamped to [0,1].
 */
function rankIncidents(incidents: Incident[]): void {
  for (const inc of incidents) {
    const deviation = Math.min(1, inc.peakScore / 8);
    const denom = Math.max(Math.abs(inc.baselineAtPeak), Number.EPSILON);
    const magnitude = Math.min(1, Math.abs(inc.peakValue - inc.baselineAtPeak) / denom);
    const durationBonus = Math.min(0.15, (inc.buckets - 1) * 0.03);
    inc.severity = Math.min(1, deviation * 0.45 + magnitude * 0.45 + durationBonus);
  }
}

/**
 * Detect incidents across several metrics and merge them into one feed sorted
 * by severity. Convenience wrapper over {@link detectIncidents} for the feed UI.
 */
export function detectIncidentsForMetrics(
  points: TimePoint[],
  keys: readonly MetricKey[],
  opts: DetectIncidentsOptions = {},
): Incident[] {
  return keys
    .flatMap((k) => detectIncidents(points, k, opts))
    .sort((a, b) => b.severity - a.severity);
}

/**
 * The typical bucket width (ms) of a series: the smallest positive gap between
 * adjacent bucket start times. Robust to sources that omit empty buckets (e.g.
 * Log Analytics' bin()), where a median gap could overshoot. Falls back to an
 * even split of the total span, or a default when there are too few points.
 */
export function bucketWidthMs(points: TimePoint[], fallback = 3_600_000): number {
  if (points.length < 2) return fallback;
  let min = Infinity;
  for (let i = 1; i < points.length; i++) {
    const gap = Date.parse(points[i].t) - Date.parse(points[i - 1].t);
    if (gap > 0 && gap < min) min = gap;
  }
  if (Number.isFinite(min)) return min;
  const span = Date.parse(points[points.length - 1].t) - Date.parse(points[0].t);
  return span > 0 ? span / (points.length - 1) : fallback;
}

/**
 * Padded [fromISO, toISO] window that frames a bucket range for "zoom to
 * incident". Bucket timestamps are the bucket START, so the raw [start,end]
 * omits the final bucket and collapses to zero width for a single bucket. We
 * extend to cover the last bucket plus one baseline bucket on each side, clamped
 * to the loaded data's edges. Always yields to > from.
 */
export function incidentZoomRange(
  points: TimePoint[],
  startIdx: number,
  endIdx: number,
): { from: string; to: string } | null {
  if (points.length === 0) return null;
  const lo = Math.max(0, Math.min(startIdx, points.length - 1));
  const hi = Math.max(lo, Math.min(endIdx, points.length - 1));
  const bucket = bucketWidthMs(points);
  const firstT = Date.parse(points[0].t);
  const lastT = Date.parse(points[points.length - 1].t);
  const from = Math.max(firstT, Date.parse(points[lo].t) - bucket);
  const to = Math.min(lastT + bucket, Date.parse(points[hi].t) + 2 * bucket);
  const safeTo = to > from ? to : from + bucket;
  return { from: new Date(from).toISOString(), to: new Date(safeTo).toISOString() };
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
