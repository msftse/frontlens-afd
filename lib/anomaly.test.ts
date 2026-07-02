import { describe, expect, it } from "vitest";

import type { Summary, TimePoint } from "@/lib/domain/types";
import {
  BREAKDOWNS,
  METRIC_CONFIG,
  bucketScores,
  bucketWidthMs,
  detectIncidents,
  detectIncidentsForMetrics,
  detectSpikes,
  incidentZoomRange,
  rollingBaseline,
  scoreMetricAnomaly,
  seriesFor,
  worstAnomaly,
  type Incident,
  type MetricAnomaly,
  type MetricKey,
} from "@/lib/anomaly";

// The eight KPI keys in the order they appear on the Overview grid.
const METRIC_KEYS: MetricKey[] = [
  "requests",
  "uniqueVisitors",
  "bytes",
  "cacheHitRatio",
  "errorRate4xx",
  "errorRate5xx",
  "p95LatencyMs",
  "avgLatencyMs",
];

// --- Fixtures ---------------------------------------------------------------

function summary(over: Partial<Summary> = {}): Summary {
  return {
    requests: 1000,
    uniqueVisitors: 200,
    bytes: 5_000_000,
    cacheHitRatio: 0.8,
    errorRate4xx: 0.01,
    errorRate5xx: 0.001,
    avgLatencyMs: 50,
    p50LatencyMs: 40,
    p95LatencyMs: 120,
    ...over,
  };
}

function tp(over: Partial<TimePoint> = {}): TimePoint {
  return {
    t: "2026-06-01T00:00:00.000Z",
    requests: 100,
    uniqueVisitors: 40,
    bytes: 500_000,
    status2xx: 90,
    status3xx: 2,
    status4xx: 5,
    status5xx: 3,
    cacheHit: 70,
    cacheMiss: 30,
    avgLatencyMs: 42,
    p95LatencyMs: 90,
    ...over,
  };
}

function anom(key: MetricKey, over: Partial<MetricAnomaly> = {}): MetricAnomaly {
  return {
    key,
    label: key,
    value: 0,
    delta: 0,
    direction: "flat",
    anomalous: false,
    severity: 0,
    goodWhenUp: true,
    text: "",
    ...over,
  };
}

/** Pull one scored metric out of the list (throws so callers stay type-safe). */
function metric(list: MetricAnomaly[], key: MetricKey): MetricAnomaly {
  const found = list.find((m) => m.key === key);
  if (!found) throw new Error(`metric ${key} not in list`);
  return found;
}

// --- METRIC_CONFIG ----------------------------------------------------------

describe("METRIC_CONFIG", () => {
  it("describes exactly the eight Overview KPIs in grid order", () => {
    expect(METRIC_CONFIG).toHaveLength(8);
    expect(METRIC_CONFIG.map((c) => c.key)).toEqual(METRIC_KEYS);
  });

  it("carries a label, direction and positive threshold for every metric", () => {
    for (const c of METRIC_CONFIG) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(typeof c.goodWhenUp).toBe("boolean");
      expect(c.relThreshold).toBeGreaterThan(0);
    }
  });

  it("only the two error-rate metrics carry an absolute floor", () => {
    const withFloor = METRIC_CONFIG.filter((c) => c.absFloor !== undefined).map((c) => c.key);
    expect(withFloor).toEqual(["errorRate4xx", "errorRate5xx"]);
  });
});

// --- scoreMetricAnomaly -----------------------------------------------------

describe("scoreMetricAnomaly", () => {
  it("returns [] for an undefined summary", () => {
    expect(scoreMetricAnomaly(undefined)).toEqual([]);
  });

  it("scores all eight metrics in config order", () => {
    const scored = scoreMetricAnomaly(summary());
    expect(scored).toHaveLength(8);
    expect(scored.map((m) => m.key)).toEqual(METRIC_KEYS);
  });

  it("flags a metric whose |delta| reaches its relative threshold", () => {
    // requests threshold is 0.3.
    const m = metric(scoreMetricAnomaly(summary({ delta: { requests: 0.5 } })), "requests");
    expect(m.anomalous).toBe(true);
    expect(m.direction).toBe("up");
  });

  it("does not flag a sub-threshold move", () => {
    const m = metric(scoreMetricAnomaly(summary({ delta: { requests: 0.1 } })), "requests");
    expect(m.anomalous).toBe(false);
  });

  it("reports a 'flat' direction (and no flag) when the delta is unknown", () => {
    const m = metric(scoreMetricAnomaly(summary()), "requests");
    expect(m.delta).toBeUndefined();
    expect(m.direction).toBe("flat");
    expect(m.anomalous).toBe(false);
  });

  it("treats a near-zero delta as flat", () => {
    const m = metric(scoreMetricAnomaly(summary({ delta: { requests: 0.0001 } })), "requests");
    expect(m.direction).toBe("flat");
    expect(m.anomalous).toBe(false);
  });

  it("follows the sign of the delta and detects in both directions", () => {
    const up = metric(scoreMetricAnomaly(summary({ delta: { requests: 0.5 } })), "requests");
    const down = metric(scoreMetricAnomaly(summary({ delta: { requests: -0.5 } })), "requests");
    expect(up.direction).toBe("up");
    expect(down.direction).toBe("down");
    // Detection is symmetric in |delta|, independent of goodWhenUp.
    expect(up.anomalous).toBe(true);
    expect(down.anomalous).toBe(true);
  });

  it("suppresses a 5xx spike below its absolute floor but not above it", () => {
    // errorRate5xx floor is 0.005; delta of +100% is well past the 0.5 threshold.
    const tiny = metric(
      scoreMetricAnomaly(summary({ errorRate5xx: 0.001, delta: { errorRate5xx: 1.0 } })),
      "errorRate5xx",
    );
    expect(tiny.anomalous).toBe(false);

    const real = metric(
      scoreMetricAnomaly(summary({ errorRate5xx: 0.02, delta: { errorRate5xx: 1.0 } })),
      "errorRate5xx",
    );
    expect(real.anomalous).toBe(true);
  });

  it("applies the 4xx floor the same way", () => {
    // errorRate4xx floor is 0.02.
    const tiny = metric(
      scoreMetricAnomaly(summary({ errorRate4xx: 0.01, delta: { errorRate4xx: 1.0 } })),
      "errorRate4xx",
    );
    expect(tiny.anomalous).toBe(false);

    const real = metric(
      scoreMetricAnomaly(summary({ errorRate4xx: 0.05, delta: { errorRate4xx: 1.0 } })),
      "errorRate4xx",
    );
    expect(real.anomalous).toBe(true);
  });

  it("keeps severity within 0..1 for every metric", () => {
    const scored = scoreMetricAnomaly(
      summary({ delta: { requests: 5, errorRate5xx: -3, p95LatencyMs: 0.4, bytes: 0.1 } }),
    );
    for (const m of scored) {
      expect(m.severity).toBeGreaterThanOrEqual(0);
      expect(m.severity).toBeLessThanOrEqual(1);
    }
  });

  it("scales severity with |delta| and caps it at 1", () => {
    const sev = (d: number) =>
      metric(scoreMetricAnomaly(summary({ delta: { requests: d } })), "requests").severity;
    // requests threshold 0.3 -> severity = |delta| / (0.3 * 2), capped at 1.
    expect(sev(0.15)).toBeCloseTo(0.25, 6);
    expect(sev(0.3)).toBeCloseTo(0.5, 6);
    expect(sev(0.45)).toBeCloseTo(0.75, 6);
    expect(sev(0.6)).toBeCloseTo(1, 6);
    expect(sev(5)).toBe(1);
    // Magnitude only: sign does not change severity.
    expect(sev(-0.3)).toBeCloseTo(0.5, 6);
    // Monotonic in |delta| below the cap.
    expect(sev(0.5)).toBeGreaterThan(sev(0.4));
  });
});

// --- worstAnomaly -----------------------------------------------------------

describe("worstAnomaly", () => {
  it("returns undefined for an empty list", () => {
    expect(worstAnomaly([])).toBeUndefined();
  });

  it("picks the highest-severity anomalous metric", () => {
    const list = [
      anom("requests", { anomalous: true, severity: 0.4 }),
      anom("errorRate5xx", { anomalous: true, severity: 0.9 }),
      anom("bytes", { anomalous: true, severity: 0.6 }),
    ];
    expect(worstAnomaly(list)).toBe("errorRate5xx");
  });

  it("prefers an anomalous metric over a higher-severity non-anomalous one", () => {
    const list = [
      anom("requests", { anomalous: true, severity: 0.3 }),
      anom("bytes", { anomalous: false, severity: 0.95 }),
    ];
    expect(worstAnomaly(list)).toBe("requests");
  });

  it("falls back to the largest mover when nothing is anomalous", () => {
    const list = [
      anom("requests", { anomalous: false, severity: 0.2 }),
      anom("bytes", { anomalous: false, severity: 0.7 }),
      anom("p95LatencyMs", { anomalous: false, severity: 0.5 }),
    ];
    expect(worstAnomaly(list)).toBe("bytes");
  });

  it("agrees with a freshly scored summary", () => {
    const worst = worstAnomaly(scoreMetricAnomaly(summary({ delta: { requests: 2 } })));
    expect(worst).toBe("requests");
  });
});

// --- seriesFor --------------------------------------------------------------

describe("seriesFor", () => {
  it("preserves bucket order for pass-through count metrics", () => {
    const points = [tp({ requests: 10 }), tp({ requests: 20 }), tp({ requests: 30 })];
    expect(seriesFor(points, "requests")).toEqual([10, 20, 30]);
    expect(seriesFor([tp({ uniqueVisitors: 7 })], "uniqueVisitors")).toEqual([7]);
    expect(seriesFor([tp({ bytes: 123 })], "bytes")).toEqual([123]);
  });

  it("derives the cache hit ratio with a 0/0 guard", () => {
    expect(seriesFor([tp({ cacheHit: 75, cacheMiss: 25 })], "cacheHitRatio")).toEqual([0.75]);
    expect(seriesFor([tp({ cacheHit: 0, cacheMiss: 0 })], "cacheHitRatio")).toEqual([0]);
  });

  it("derives 4xx/5xx rates with a 0-requests guard", () => {
    expect(seriesFor([tp({ requests: 100, status4xx: 10 })], "errorRate4xx")).toEqual([0.1]);
    expect(seriesFor([tp({ requests: 100, status5xx: 5 })], "errorRate5xx")).toEqual([0.05]);
    expect(seriesFor([tp({ requests: 0, status4xx: 10 })], "errorRate4xx")).toEqual([0]);
    expect(seriesFor([tp({ requests: 0, status5xx: 5 })], "errorRate5xx")).toEqual([0]);
  });

  it("reads each latency metric from its own per-bucket aggregate", () => {
    const pts = [tp({ avgLatencyMs: 42, p95LatencyMs: 210 })];
    expect(seriesFor(pts, "avgLatencyMs")).toEqual([42]);
    expect(seriesFor(pts, "p95LatencyMs")).toEqual([210]);
  });

  it("returns an empty series for no points", () => {
    expect(seriesFor([], "requests")).toEqual([]);
  });
});

// --- detectSpikes -----------------------------------------------------------

describe("detectSpikes", () => {
  it("needs at least four points", () => {
    expect(detectSpikes([1, 2, 3])).toEqual({ idxs: [] });
    expect(detectSpikes([])).toEqual({ idxs: [] });
  });

  it("finds a single spike in an otherwise steady series and windows it", () => {
    const res = detectSpikes([20, 21, 19, 20, 21, 19, 20, 800]);
    expect(res.idxs).toEqual([7]);
    expect(res.window).toEqual({ startIdx: 7, endIdx: 7 });
  });

  it("spans the window across multiple spikes", () => {
    const res = detectSpikes([100, 101, 5000, 100, 101, 99, 6000, 101, 99, 100]);
    expect(res.idxs).toEqual([2, 6]);
    expect(res.window).toEqual({ startIdx: 2, endIdx: 6 });
  });

  it("returns no spikes (and no window) for an all-equal series", () => {
    const res = detectSpikes([50, 50, 50, 50, 50]);
    expect(res.idxs).toEqual([]);
    expect(res.window).toBeUndefined();
  });

  it("flags a lone jump via the MAD==0 mean/sd fallback", () => {
    // 19 identical values force MAD to 0; the fallback z-score of a single
    // outlier is sqrt(n-1) = sqrt(19) ~= 4.36, which clears the 3.5 cutoff.
    const flatWithJump = [...Array.from({ length: 19 }, () => 5), 500];
    const res = detectSpikes(flatWithJump);
    expect(res.idxs).toEqual([19]);
    expect(res.window).toEqual({ startIdx: 19, endIdx: 19 });
  });

  it("honours the k sensitivity threshold", () => {
    // |25 - median| / (1.4826 * MAD) ~= 3.37: under the 3.5 default, over k=3.
    const values = [20, 21, 19, 20, 21, 19, 20, 25];
    expect(detectSpikes(values).idxs).toEqual([]);
    expect(detectSpikes(values, 3).idxs).toEqual([7]);
  });
});

// --- BREAKDOWNS -------------------------------------------------------------

describe("BREAKDOWNS", () => {
  it("decomposes every KPI into at least one dimension", () => {
    expect(Object.keys(BREAKDOWNS).sort()).toEqual([...METRIC_KEYS].sort());
    for (const key of METRIC_KEYS) {
      expect(BREAKDOWNS[key].dims.length).toBeGreaterThan(0);
    }
  });
});

// --- Incident engine --------------------------------------------------------

/** Build a timeseries from per-bucket overrides, 1 minute apart from a base. */
function series(overrides: Partial<TimePoint>[], baseMs = Date.parse("2026-06-01T00:00:00.000Z")): TimePoint[] {
  return overrides.map((o, i) => tp({ t: new Date(baseMs + i * 60_000).toISOString(), ...o }));
}

/** Shorthand: a requests-only series from raw counts. */
function requestSeries(counts: number[]): TimePoint[] {
  return series(counts.map((requests) => ({ requests })));
}

describe("rollingBaseline", () => {
  it("returns one baseline point per value", () => {
    const b = rollingBaseline([1, 2, 3, 4, 5, 6], 4);
    expect(b).toHaveLength(6);
  });

  it("uses the global center while history is too short, then goes local", () => {
    const values = [10, 10, 10, 10, 10, 10, 10, 1000];
    const b = rollingBaseline(values, 6);
    // Early buckets fall back to the global median (10 dominates).
    expect(b[0].center).toBeCloseTo(10, 6);
    // The trailing window before the spike is all 10s -> local center 10.
    expect(b[7].center).toBeCloseTo(10, 6);
    expect(b[7].scale).toBeGreaterThan(0);
  });

  it("keeps scale strictly positive even on a perfectly flat history", () => {
    const b = rollingBaseline([5, 5, 5, 5, 5, 5], 4);
    for (const p of b) expect(p.scale).toBeGreaterThan(0);
  });
});

describe("bucketScores", () => {
  it("scores a flat series near zero and a spike far above", () => {
    const s = bucketScores([20, 21, 19, 20, 21, 19, 20, 800], 6);
    for (let i = 0; i < 7; i++) expect(Math.abs(s[i])).toBeLessThan(3.5);
    expect(s[7]).toBeGreaterThan(5);
  });

  it("signs a drop negative", () => {
    const s = bucketScores([100, 101, 99, 100, 101, 99, 100, 2], 6);
    expect(s[7]).toBeLessThan(-5);
  });
});

describe("detectIncidents", () => {
  it("returns nothing for a short or flat series", () => {
    expect(detectIncidents(requestSeries([1, 2, 3]), "requests")).toEqual([]);
    expect(detectIncidents(requestSeries([50, 50, 50, 50, 50, 50]), "requests")).toEqual([]);
  });

  it("detects a single-bucket requests drop (unhealthy direction is down)", () => {
    // requests is goodWhenUp -> only a DROP is an incident.
    const pts = requestSeries([100, 101, 99, 100, 101, 99, 100, 2, 100, 101]);
    const inc = detectIncidents(pts, "requests", { window: 6 });
    expect(inc).toHaveLength(1);
    expect(inc[0].direction).toBe("down");
    expect(inc[0].startIdx).toBe(7);
    expect(inc[0].endIdx).toBe(7);
    expect(inc[0].buckets).toBe(1);
    expect(inc[0].peakValue).toBe(2);
    expect(inc[0].startTime).toBe(pts[7].t);
  });

  it("ignores a requests spike (rise is the healthy direction)", () => {
    const pts = requestSeries([100, 101, 99, 100, 101, 99, 100, 900, 100, 101]);
    expect(detectIncidents(pts, "requests", { window: 6 })).toEqual([]);
  });

  it("detects a sustained 5xx-rate incident and bridges a one-bucket dip", () => {
    // errorRate5xx: bad direction is up; floor 0.005. Build rate via status5xx.
    const base = { requests: 1000, status5xx: 1 }; // 0.001, below floor
    const hot = { requests: 1000, status5xx: 200 }; // 0.2, well above
    const dip = { requests: 1000, status5xx: 1 };
    const pts = series([
      base, base, base, base, base, base,
      hot, hot, dip, hot, // one-bucket dip inside the event
      base, base,
    ]);
    const inc = detectIncidents(pts, "errorRate5xx", { window: 6, maxGap: 1 });
    expect(inc).toHaveLength(1);
    expect(inc[0].direction).toBe("up");
    expect(inc[0].startIdx).toBe(6);
    expect(inc[0].endIdx).toBe(9); // bridged across the dip at idx 8
    expect(inc[0].buckets).toBe(4);
  });

  it("respects the absolute floor: tiny rates never fire", () => {
    // A big relative jump but still below the 5xx floor (0.005).
    const lo = { requests: 100000, status5xx: 0 };
    const hi = { requests: 100000, status5xx: 100 }; // 0.001, below floor
    const pts = series([lo, lo, lo, lo, lo, lo, hi, hi, lo, lo]);
    expect(detectIncidents(pts, "errorRate5xx", { window: 6 })).toEqual([]);
  });

  it("splits two separated events into two incidents", () => {
    const pts = requestSeries([
      100, 101, 99, 100, 101, 99, 100, // baseline
      2, // drop 1
      100, 101, 99, 100, 101, 99, 100, // recovery
      3, // drop 2
      100, 101,
    ]);
    const inc = detectIncidents(pts, "requests", { window: 6, maxGap: 1 });
    expect(inc).toHaveLength(2);
    // Both are single-bucket drops; sorted by severity (peak deviation).
    const idxs = inc.map((i) => i.startIdx).sort((a, b) => a - b);
    expect(idxs).toEqual([7, 15]);
  });

  it("honours minBuckets to drop blips", () => {
    const pts = requestSeries([100, 101, 99, 100, 101, 99, 100, 2, 100, 101]);
    expect(detectIncidents(pts, "requests", { window: 6, minBuckets: 2 })).toEqual([]);
  });

  it("orders incidents by descending severity and keeps it in 0..1", () => {
    const pts = requestSeries([
      100, 101, 99, 100, 101, 99, 100,
      40, // mild drop
      100, 101, 99, 100, 101, 99, 100,
      1, // severe drop
      100, 101,
    ]);
    const inc = detectIncidents(pts, "requests", { window: 6 });
    expect(inc.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < inc.length; i++) {
      expect(inc[i - 1].severity).toBeGreaterThanOrEqual(inc[i].severity);
    }
    for (const x of inc) {
      expect(x.severity).toBeGreaterThanOrEqual(0);
      expect(x.severity).toBeLessThanOrEqual(1);
    }
    // The severe drop (value 1) should outrank the mild one (value 40).
    expect(inc[0].peakValue).toBe(1);
  });

  it("captures the baseline at the peak for 'what normal looked like'", () => {
    const pts = requestSeries([200, 200, 200, 200, 200, 200, 200, 5, 200, 200]);
    const inc = detectIncidents(pts, "requests", { window: 6 });
    expect(inc[0].baselineAtPeak).toBeCloseTo(200, 6);
    expect(inc[0].peakValue).toBe(5);
  });
});

describe("detectIncidentsForMetrics", () => {
  it("merges incidents across metrics sorted by severity", () => {
    // A requests drop AND a 5xx rise in the same series.
    const pts = series([
      { requests: 1000, status5xx: 1 },
      { requests: 1000, status5xx: 1 },
      { requests: 1000, status5xx: 1 },
      { requests: 1000, status5xx: 1 },
      { requests: 1000, status5xx: 1 },
      { requests: 1000, status5xx: 1 },
      { requests: 5, status5xx: 1 }, // requests drop
      { requests: 1000, status5xx: 400 }, // 5xx rise
      { requests: 1000, status5xx: 1 },
      { requests: 1000, status5xx: 1 },
    ]);
    const inc = detectIncidentsForMetrics(pts, ["requests", "errorRate5xx"], { window: 6 });
    const metrics = new Set(inc.map((i) => i.metric));
    expect(metrics.has("requests")).toBe(true);
    expect(metrics.has("errorRate5xx")).toBe(true);
    for (let i = 1; i < inc.length; i++) {
      expect(inc[i - 1].severity).toBeGreaterThanOrEqual(inc[i].severity);
    }
  });

  it("returns an empty feed when nothing is anomalous", () => {
    const pts = requestSeries([100, 100, 100, 100, 100, 100, 100, 100]);
    const feed: Incident[] = detectIncidentsForMetrics(pts, ["requests", "errorRate5xx", "p95LatencyMs"], {
      window: 6,
    });
    expect(feed).toEqual([]);
  });
});

// --- bucketWidthMs / incidentZoomRange --------------------------------------

describe("bucketWidthMs", () => {
  it("falls back for too-few points", () => {
    expect(bucketWidthMs([], 1234)).toBe(1234);
    expect(bucketWidthMs(requestSeries([1]), 1234)).toBe(1234);
  });

  it("takes the smallest positive gap (robust to omitted empty buckets)", () => {
    // series() spaces buckets 60s apart.
    expect(bucketWidthMs(requestSeries([1, 2, 3, 4]))).toBe(60_000);
  });

  it("recovers a 60s width even when a bucket is skipped", () => {
    const base = Date.parse("2026-06-01T00:00:00.000Z");
    // Buckets at 0, 60s, 180s (120s hole) -> min positive gap is still 60s.
    const pts = [
      tp({ t: new Date(base).toISOString() }),
      tp({ t: new Date(base + 60_000).toISOString() }),
      tp({ t: new Date(base + 180_000).toISOString() }),
    ];
    expect(bucketWidthMs(pts)).toBe(60_000);
  });
});

describe("incidentZoomRange", () => {
  it("returns null for an empty series", () => {
    expect(incidentZoomRange([], 0, 0)).toBeNull();
  });

  it("pads a single-bucket incident to a non-zero window within data bounds", () => {
    const pts = requestSeries([10, 20, 30, 40, 50, 60]); // 6 buckets, 60s apart
    const r = incidentZoomRange(pts, 2, 2);
    expect(r).not.toBeNull();
    const from = Date.parse(r!.from);
    const to = Date.parse(r!.to);
    expect(to).toBeGreaterThan(from);
    // One bucket of padding before idx 2, clamped to the series edges.
    expect(from).toBe(Date.parse(pts[1].t)); // idx2 start - 60s = idx1 start
    // idx2 start + 2 buckets, clamped to lastT + 1 bucket.
    expect(to).toBeLessThanOrEqual(Date.parse(pts[5].t) + 60_000);
  });

  it("clamps a span to the loaded window edges", () => {
    const pts = requestSeries([10, 20, 30, 40]);
    const r = incidentZoomRange(pts, 0, 3)!;
    expect(Date.parse(r.from)).toBe(Date.parse(pts[0].t)); // can't pad before first
    expect(Date.parse(r.to)).toBe(Date.parse(pts[3].t) + 60_000); // last + 1 bucket
  });

  it("tolerates out-of-order / out-of-range indices", () => {
    const pts = requestSeries([10, 20, 30, 40]);
    const r = incidentZoomRange(pts, 99, -5)!;
    expect(Date.parse(r.to)).toBeGreaterThan(Date.parse(r.from));
  });
});
