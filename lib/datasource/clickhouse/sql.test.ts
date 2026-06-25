import { describe, expect, it } from "vitest";

import { filterSchema, resolveTimeRange } from "@/lib/filters/model";
import {
  applyFilter,
  applyRollupFilter,
  autoBucketSeconds,
  canUseTrafficRollup,
  cidrRange,
  dimExpr,
  pathGroupExpr,
  SqlBuilder,
} from "@/lib/datasource/clickhouse/sql";

function compile(input: Record<string, unknown>) {
  const f = filterSchema.parse(input);
  const { from, to } = resolveTimeRange(f);
  const s = new SqlBuilder();
  applyFilter(s, f, from, to);
  return { where: s.where(), params: Object.values(s.params) };
}

describe("applyFilter — parameterization & semantics", () => {
  const { where, params } = compile({
    range: "7d",
    host: ["nadav.com"],
    country: ["US", "IL"],
    path: [
      { mode: "regex", value: "a{1,3}" },
      { mode: "prefix", value: "nadav.com/api" },
      { mode: "glob", value: "/api/*" },
    ],
    status: ["4xx", 500],
    cidr: ["203.0.113.0/24"],
    q: "foo,bar",
  });

  it("keeps comma-bearing values as single parameters (no SQL injection surface)", () => {
    expect(params).toContain("(?i)a{1,3}");
    expect(params).toContain("foo,bar");
  });

  it("passes IN-lists as array params", () => {
    expect(params.some((p) => Array.isArray(p) && (p as string[]).join() === "US,IL")).toBe(true);
  });

  it("matches prefix against both path and host+path", () => {
    expect(where).toMatch(/startsWith\(lowerUTF8\(path\).*OR startsWith\(lowerUTF8\(hostPath\)/);
  });

  it("uses match() for glob/regex on path and hostPath", () => {
    expect(where).toMatch(/match\(path,.*OR match\(hostPath/);
  });

  it("emits both class and exact status predicates", () => {
    expect(where).toContain("statusClass = ");
    expect(where).toContain("status = ");
  });

  it("bounds time with fromUnixTimestamp64Milli", () => {
    expect(where).toContain("fromUnixTimestamp64Milli");
  });
});

describe("applyFilter — negation (not / Exclude)", () => {
  it("emits NOT IN for negated string facets, as array params", () => {
    const { where, params } = compile({
      range: "24h",
      not: { country: ["US", "IL"], host: ["a.com"] },
    });
    expect(where).toMatch(/country NOT IN/);
    expect(where).toMatch(/host NOT IN/);
    expect(params.some((p) => Array.isArray(p) && (p as string[]).join() === "US,IL")).toBe(true);
  });

  it("maps the referer (none) sentinel to the empty string when negating", () => {
    const { where, params } = compile({ range: "24h", not: { referer: ["(none)"] } });
    expect(where).toMatch(/referer NOT IN/);
    expect(params.some((p) => Array.isArray(p) && (p as string[]).join() === "")).toBe(true);
  });

  it("negates status with NOT ( ... OR ... ), class and exact", () => {
    const { where } = compile({ range: "24h", not: { status: ["4xx", 500] } });
    expect(where).toContain("NOT (");
    expect(where).toContain("statusClass = ");
    expect(where).toContain("status = ");
  });
});

describe("cidrRange", () => {
  it("computes the inclusive numeric range", () => {
    const r = cidrRange("203.0.113.0/24");
    expect(r).toEqual({ start: 0xcb007100, end: 0xcb0071ff });
  });
  it("handles /0 and rejects malformed input", () => {
    expect(cidrRange("0.0.0.0/0")).toEqual({ start: 0, end: 0xffffffff });
    expect(cidrRange("203.0.113.0/33")).toBeNull();
    expect(cidrRange("nope")).toBeNull();
  });
});

describe("dimExpr / pathGroupExpr / autoBucketSeconds", () => {
  it("groups paths by hostPath", () => {
    expect(dimExpr("path").key).toBe("hostPath");
  });
  it("formats statusClass and referer dimensions", () => {
    expect(dimExpr("statusClass").key).toContain("statusClass");
    expect(dimExpr("referer").key).toContain("'(none)'");
  });
  it("trims path depth", () => {
    expect(pathGroupExpr(0)).toBe("path");
    expect(pathGroupExpr(2)).toContain("arraySlice");
  });
  it("picks a sane bucket size", () => {
    expect(autoBucketSeconds(3600)).toBeGreaterThanOrEqual(60);
    expect(autoBucketSeconds(90 * 86400)).toBe(86400);
    expect(autoBucketSeconds(400 * 86400)).toBe(604800);
  });
});

describe("canUseTrafficRollup", () => {
  it("accepts filters limited to rollup dimensions", () => {
    expect(canUseTrafficRollup(filterSchema.parse({}))).toBe(true);
    expect(
      canUseTrafficRollup(
        filterSchema.parse({ host: ["a"], country: ["US"], cacheStatus: ["HIT"], status: ["4xx"] }),
      ),
    ).toBe(true);
  });

  it("rejects filters touching non-rollup dimensions", () => {
    expect(canUseTrafficRollup(filterSchema.parse({ path: [{ mode: "prefix", value: "/api" }] }))).toBe(false);
    expect(canUseTrafficRollup(filterSchema.parse({ clientIp: ["1.2.3.4"] }))).toBe(false);
    expect(canUseTrafficRollup(filterSchema.parse({ pop: ["LAX"] }))).toBe(false);
    expect(canUseTrafficRollup(filterSchema.parse({ q: "x" }))).toBe(false);
  });

  it("rejects exact status codes (rollup only stores statusClass)", () => {
    expect(canUseTrafficRollup(filterSchema.parse({ status: [500] }))).toBe(false);
    expect(canUseTrafficRollup(filterSchema.parse({ status: ["5xx"] }))).toBe(true);
  });

  it("rejects any negation — the rollup can't express exclusions", () => {
    expect(canUseTrafficRollup(filterSchema.parse({ not: { host: ["a.com"] } }))).toBe(false);
    expect(canUseTrafficRollup(filterSchema.parse({ not: { country: ["US"] } }))).toBe(false);
    expect(canUseTrafficRollup(filterSchema.parse({ not: { status: ["4xx"] } }))).toBe(false);
    // An empty `not` (no excluded values) stays eligible for the rollup.
    expect(canUseTrafficRollup(filterSchema.parse({ not: {} }))).toBe(true);
  });
});

describe("applyRollupFilter", () => {
  it("ranges over the bucket column and the rollup dimensions only", () => {
    const f = filterSchema.parse({
      range: "24h",
      host: ["nadav.com"],
      country: ["US"],
      cacheStatus: ["HIT"],
      status: ["5xx"],
    });
    const { from, to } = resolveTimeRange(f);
    const s = new SqlBuilder();
    applyRollupFilter(s, f, from, to);
    const where = s.where();
    const params = Object.values(s.params);

    expect(where).toContain("bucket >= fromUnixTimestamp64Milli");
    expect(where).toContain("bucket <= fromUnixTimestamp64Milli");
    expect(where).toMatch(/host IN/);
    expect(where).toMatch(/country IN/);
    expect(where).toMatch(/cacheStatus IN/);
    expect(where).toContain("statusClass = ");
    expect(params).toContainEqual(["nadav.com"]);
    expect(params).toContainEqual(["US"]);
    // never references raw-only columns
    expect(where).not.toContain("timestamp");
  });
});
