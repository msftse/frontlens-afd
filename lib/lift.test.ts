import { describe, expect, it } from "vitest";

import { computeLift, baselineWindowFor, type LiftRow } from "@/lib/lift";
import type { TopNRow } from "@/lib/domain/types";

/** Minimal TopNRow with just the fields computeLift reads. */
function row(key: string, requests: number): TopNRow {
  return {
    key,
    label: key,
    requests,
    uniqueVisitors: 0,
    bytes: 0,
    errorRate: 0,
    cacheHitRatio: 0,
    share: 0,
  };
}

function byKey(rows: LiftRow[]): Map<string, LiftRow> {
  return new Map(rows.map((r) => [r.key, r]));
}

describe("computeLift", () => {
  it("returns [] when the incident window is empty", () => {
    expect(computeLift([], [row("a", 10)])).toEqual([]);
  });

  it("flags a value that is over-represented during the incident", () => {
    // Incident: IP x is 80% of traffic; baseline: x is 10%. Lift ~ 8.
    const incident = [row("x", 80), row("y", 20)];
    const baseline = [row("x", 10), row("y", 90)];
    const rows = computeLift(incident, baseline, { minLift: 1.5 });
    const x = byKey(rows).get("x")!;
    expect(x).toBeDefined();
    expect(x.incidentShare).toBeCloseTo(0.8, 6);
    expect(x.baselineShare).toBeCloseTo(0.1, 6);
    expect(x.lift).toBeCloseTo(8, 6);
    expect(x.isNew).toBe(false);
    expect(x.sharePointDelta).toBeCloseTo(70, 6);
  });

  it("does not surface an under-represented value", () => {
    const incident = [row("x", 80), row("y", 20)];
    const baseline = [row("x", 10), row("y", 90)];
    // y drops from 90% to 20% -> lift < 1, filtered out by minLift.
    expect(byKey(computeLift(incident, baseline)).has("y")).toBe(false);
  });

  it("marks a newcomer (absent at baseline) as new with infinite lift", () => {
    const incident = [row("attacker", 70), row("x", 30)];
    const baseline = [row("x", 100)];
    const rows = computeLift(incident, baseline);
    const a = byKey(rows).get("attacker")!;
    expect(a.isNew).toBe(true);
    expect(a.lift).toBe(Infinity);
    expect(a.baselineRequests).toBe(0);
  });

  it("orders newcomers first, then by lift, then by incident share", () => {
    const incident = [row("newbig", 50), row("over", 40), row("small", 10)];
    const baseline = [row("over", 100), row("small", 100)]; // 'over' & 'small' both known
    const rows = computeLift(incident, baseline, { minLift: 1.1, minIncidentShare: 0 });
    // newbig is new -> first.
    expect(rows[0].key).toBe("newbig");
    // 'over' at 40% incident vs 50% baseline -> lift 0.8, filtered. 'small' 10% vs
    // 50% -> filtered. So only the newcomer survives here.
    expect(rows.map((r) => r.key)).toEqual(["newbig"]);
  });

  it("ranks two suspects by lift", () => {
    const incident = [row("a", 50), row("b", 50)];
    const baseline = [row("a", 5), row("b", 25), row("filler", 70)];
    const rows = computeLift(incident, baseline, { minLift: 1.1 });
    // a: 0.5 / 0.05 = 10; b: 0.5 / 0.25 = 2. a should rank above b.
    expect(rows.map((r) => r.key)).toEqual(["a", "b"]);
    expect(rows[0].lift).toBeCloseTo(10, 6);
    expect(rows[1].lift).toBeCloseTo(2, 6);
  });

  it("ignores values below the minimum incident share", () => {
    const incident = [row("big", 995), row("tiny", 5)]; // tiny = 0.5%
    const baseline = [row("big", 1000)]; // tiny is new but negligible
    const rows = computeLift(incident, baseline, { minIncidentShare: 0.01 });
    expect(byKey(rows).has("tiny")).toBe(false);
  });

  it("uses smoothing so a tiny baseline doesn't explode the ranking lift", () => {
    // x: 50% incident vs 0.1% baseline. Raw lift = 500, but smoothing tempers
    // the *ranking* while the reported lift stays the true ratio.
    const incident = [row("x", 500), row("y", 500)];
    const baseline = [row("x", 1), row("y", 999)];
    const rows = computeLift(incident, baseline, { minLift: 1.5 });
    const x = byKey(rows).get("x")!;
    expect(x.lift).toBeCloseTo(0.5 / 0.001, 3); // reported = true ratio
    expect(x.isNew).toBe(false);
  });

  it("respects the row limit", () => {
    const incident = Array.from({ length: 30 }, (_, i) => row(`k${i}`, 100 - i));
    const baseline = [row("other", 1000)]; // everything in incident is new
    const rows = computeLift(incident, baseline, { limit: 5, minIncidentShare: 0 });
    expect(rows).toHaveLength(5);
  });

  it("computes shares against each window's own total (unequal windows)", () => {
    // Incident window much smaller than baseline; shares still comparable.
    const incident = [row("x", 30), row("y", 10)]; // total 40
    const baseline = [row("x", 300), row("y", 2700)]; // total 3000
    const rows = computeLift(incident, baseline, { minLift: 1.1 });
    const x = byKey(rows).get("x")!;
    expect(x.incidentShare).toBeCloseTo(0.75, 6);
    expect(x.baselineShare).toBeCloseTo(0.1, 6);
    expect(x.lift).toBeCloseTo(7.5, 6);
  });
});

describe("baselineWindowFor", () => {
  it("returns a window that ends where the incident begins", () => {
    const w = baselineWindowFor("2026-06-01T12:00:00.000Z", "2026-06-01T13:00:00.000Z")!;
    expect(w.to).toBe("2026-06-01T12:00:00.000Z");
    // 1h incident * 4 = 4h baseline.
    expect(w.from).toBe("2026-06-01T08:00:00.000Z");
  });

  it("honours a custom multiple", () => {
    const w = baselineWindowFor("2026-06-01T12:00:00.000Z", "2026-06-01T13:00:00.000Z", {
      multiple: 2,
    })!;
    expect(w.from).toBe("2026-06-01T10:00:00.000Z");
  });

  it("caps the baseline span at maxMs", () => {
    const w = baselineWindowFor("2026-06-01T12:00:00.000Z", "2026-06-01T13:00:00.000Z", {
      multiple: 1000,
      maxMs: 2 * 3_600_000, // cap at 2h
    })!;
    expect(w.from).toBe("2026-06-01T10:00:00.000Z");
  });

  it("clamps the start to the earliest loaded edge", () => {
    const w = baselineWindowFor("2026-06-01T12:00:00.000Z", "2026-06-01T13:00:00.000Z", {
      earliest: "2026-06-01T11:00:00.000Z",
    })!;
    expect(w.from).toBe("2026-06-01T11:00:00.000Z");
    expect(w.to).toBe("2026-06-01T12:00:00.000Z");
  });

  it("returns null for a zero/negative-duration or unparseable incident", () => {
    expect(baselineWindowFor("2026-06-01T12:00:00.000Z", "2026-06-01T12:00:00.000Z")).toBeNull();
    expect(baselineWindowFor("2026-06-01T13:00:00.000Z", "2026-06-01T12:00:00.000Z")).toBeNull();
    expect(baselineWindowFor("nonsense", "also-bad")).toBeNull();
  });

  it("returns null when the earliest edge leaves no room", () => {
    expect(
      baselineWindowFor("2026-06-01T12:00:00.000Z", "2026-06-01T13:00:00.000Z", {
        earliest: "2026-06-01T12:00:00.000Z", // baseline would be empty
      }),
    ).toBeNull();
  });
});
