import { beforeAll, describe, expect, it } from "vitest";

import type { DataSource } from "@/lib/datasource/types";
import { filterSchema, type Filter } from "@/lib/filters/model";

let ds: DataSource;
const f: Filter = filterSchema.parse({ range: "90d" });

beforeAll(async () => {
  process.env.MOCK_RECORDS = "4000";
  process.env.MOCK_VISITORS = "150";
  const { MockDataSource } = await import("@/lib/datasource/mock");
  ds = new MockDataSource();
});

describe("MockDataSource.waf", () => {
  it("exposes a WAF surface", () => {
    expect(ds.waf).toBeDefined();
  });

  it("summary reports consistent WAF totals", async () => {
    const s = await ds.waf!.summary(f);
    expect(s.total).toBeGreaterThan(0);
    expect(s.blocked + s.logged + s.scored).toBeLessThanOrEqual(s.total);
    expect(s.blockRate).toBeGreaterThanOrEqual(0);
    expect(s.blockRate).toBeLessThanOrEqual(1);
    expect(s.distinctRules).toBeGreaterThan(0);
    expect(s.distinctIps).toBeGreaterThan(0);
  });

  it("timeseries block counts sum to the summary blocked total", async () => {
    const [s, ts] = await Promise.all([ds.waf!.summary(f), ds.waf!.timeseries(f)]);
    const blocked = ts.reduce((n, p) => n + p.blocked, 0);
    // Bucketed series should account for every blocked event in the window.
    expect(blocked).toBe(s.blocked);
  });

  it("topN rules are sorted, share-normalized and carry blocked counts", async () => {
    const rows = await ds.waf!.topN(f, { dimension: "ruleName", limit: 10 });
    expect(rows.length).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].count).toBeGreaterThanOrEqual(rows[i].count);
    }
    for (const r of rows) {
      expect(r.blocked).toBeLessThanOrEqual(r.count);
      expect(r.share).toBeGreaterThanOrEqual(0);
      expect(r.share).toBeLessThanOrEqual(1);
    }
  });

  it("topN can filter to a single action", async () => {
    const blocks = await ds.waf!.topN(f, { dimension: "ruleName", action: "Block", limit: 10 });
    // Every returned rule fired as a Block, so blocked == count for each.
    for (const r of blocks) expect(r.blocked).toBe(r.count);
  });

  it("events paginate newest-first and join back via trackingRef", async () => {
    const page = await ds.waf!.events(f, { limit: 5 });
    expect(page.rows.length).toBeGreaterThan(0);
    expect(page.total).toBeGreaterThanOrEqual(page.rows.length);
    for (const e of page.rows) {
      expect(e.trackingRef).toBeTruthy();
      expect(["Block", "Log", "AnomalyScoring", "Allow", "JSChallenge", "Redirect"]).toContain(e.action);
    }
    // Newest first.
    for (let i = 1; i < page.rows.length; i++) {
      expect(page.rows[i - 1].timestamp >= page.rows[i].timestamp).toBe(true);
    }
  });

  it("an unmatched filter yields no WAF activity", async () => {
    const none = filterSchema.parse({ range: "90d", country: ["ZZ"] });
    const s = await ds.waf!.summary(none);
    expect(s.total).toBe(0);
    expect((await ds.waf!.events(none)).total).toBe(0);
  });
});
