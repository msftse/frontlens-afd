import { beforeAll, describe, expect, it } from "vitest";

import type { DataSource } from "@/lib/datasource/types";
import { filterSchema, type Filter } from "@/lib/filters/model";

// A small, deterministic dataset keeps the contract suite fast. Env must be set
// before the mock module (which lazily generates on first query) is imported.
let ds: DataSource;
const f: Filter = filterSchema.parse({ range: "90d" });

beforeAll(async () => {
  process.env.MOCK_RECORDS = "4000";
  process.env.MOCK_VISITORS = "150";
  const { MockDataSource } = await import("@/lib/datasource/mock");
  ds = new MockDataSource();
});

describe("MockDataSource contract", () => {
  it("identifies as the mock source", () => {
    expect(ds.name).toBe("mock");
  });

  it("summary returns ratios in [0,1] plus a delta", async () => {
    const s = await ds.summary(f);
    expect(s.requests).toBeGreaterThan(0);
    for (const k of ["cacheHitRatio", "errorRate4xx", "errorRate5xx"] as const) {
      expect(s[k]).toBeGreaterThanOrEqual(0);
      expect(s[k]).toBeLessThanOrEqual(1);
    }
    expect(s.delta).toBeDefined();
  });

  it("summary.requests equals the matched log total (cross-method invariant)", async () => {
    const [s, logs] = await Promise.all([ds.summary(f), ds.logs(f)]);
    expect(s.requests).toBe(logs.total);
  });

  it("timeseries request counts sum to the summary total", async () => {
    const [s, ts] = await Promise.all([ds.summary(f), ds.timeseries(f)]);
    const sum = ts.reduce((acc, p) => acc + p.requests, 0);
    expect(sum).toBe(s.requests);
  });

  it("topN is sorted, bounded and share-normalized", async () => {
    const top = await ds.topN(f, { dimension: "country", limit: 5 });
    expect(top.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < top.length; i++) {
      expect(top[i - 1].requests).toBeGreaterThanOrEqual(top[i].requests);
    }
    for (const r of top) {
      expect(r.share).toBeGreaterThanOrEqual(0);
      expect(r.share).toBeLessThanOrEqual(1);
    }
  });

  it("geo shares sum to ~1", async () => {
    const geo = await ds.geo(f);
    expect(geo.length).toBeGreaterThan(0);
    const shareSum = geo.reduce((acc, r) => acc + r.share, 0);
    expect(shareSum).toBeCloseTo(1, 5);
  });

  it("paths reports a total at least as large as the returned page", async () => {
    const paths = await ds.paths(f, { limit: 20 });
    expect(paths.total).toBeGreaterThanOrEqual(paths.rows.length);
    for (const r of paths.rows) {
      expect(r.host).toBeTruthy();
      expect(r.path.startsWith("/")).toBe(true);
    }
  });

  it("visitor pages do not overlap across offsets", async () => {
    const [p1, p2] = await Promise.all([
      ds.visitors(f, { limit: 10, offset: 0 }),
      ds.visitors(f, { limit: 10, offset: 10 }),
    ]);
    const seen = new Set(p1.rows.map((r) => r.clientIp));
    expect(p2.rows.every((r) => !seen.has(r.clientIp))).toBe(true);
    expect(p1.total).toBeGreaterThanOrEqual(p1.rows.length);
  });

  it("logs paginate by cursor, newest first", async () => {
    const l1 = await ds.logs(f, { limit: 50 });
    expect(l1.rows.length).toBeLessThanOrEqual(50);
    for (let i = 1; i < l1.rows.length; i++) {
      expect(l1.rows[i - 1].timestamp >= l1.rows[i].timestamp).toBe(true);
    }
    if (l1.nextCursor) {
      const l2 = await ds.logs(f, { limit: 50, cursor: l1.nextCursor });
      expect(l2.rows[0]?.trackingRef).not.toBe(l1.rows[0]?.trackingRef);
    }
  });

  it("visitorDetail drills into a real visitor", async () => {
    const top = await ds.visitors(f, { limit: 1 });
    const ip = top.rows[0].clientIp;
    const detail = await ds.visitorDetail(f, ip);
    expect(detail).not.toBeNull();
    expect(detail?.visitor.clientIp).toBe(ip);
    expect((detail?.recent.length ?? 0)).toBeGreaterThan(0);
  });

  it("facetValues returns labeled rows", async () => {
    const facets = await ds.facetValues(f, "host", 10);
    expect(facets.length).toBeGreaterThan(0);
    expect(facets[0].key).toBeTruthy();
  });

  it("an unmatched filter yields empty results", async () => {
    const none = filterSchema.parse({ range: "90d", country: ["ZZ"] });
    expect((await ds.summary(none)).requests).toBe(0);
    expect(await ds.geo(none)).toEqual([]);
    expect((await ds.logs(none)).total).toBe(0);
  });
});
