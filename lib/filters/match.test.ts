import { describe, expect, it } from "vitest";

import type { AccessLogRecord } from "@/lib/domain/types";
import { filterSchema, resolveTimeRange, type Filter } from "@/lib/filters/model";
import { buildMatchContext, cidrMatch, compilePathPattern, matchesFilter } from "@/lib/filters/match";

function rec(p: Partial<AccessLogRecord> = {}): AccessLogRecord {
  return {
    trackingRef: "ref",
    timestamp: "2026-06-01T00:00:00.000Z",
    method: "GET",
    httpVersion: "2.0",
    scheme: "https",
    host: "nadav.com",
    path: "/api/v1/quote",
    query: "",
    url: "https://nadav.com/api/v1/quote",
    status: 200,
    protocol: "HTTPS",
    requestBytes: 100,
    responseBytes: 1000,
    timeTaken: 0.1,
    timeToFirstByte: 0.05,
    clientIp: "203.0.113.5",
    socketIp: "203.0.113.5",
    clientPort: 4000,
    country: "US",
    countryName: "United States",
    city: "Ashburn",
    latitude: 0,
    longitude: 0,
    asn: 7018,
    asnOrg: "AT&T",
    userAgent: "Mozilla/5.0 Chrome",
    uaFamily: "Chrome",
    uaOs: "Windows",
    deviceType: "desktop",
    ja4: "t13d1516",
    referer: "",
    endpoint: "ep",
    pop: "LAX",
    cacheStatus: "HIT",
    routeName: "route",
    ruleSetName: "",
    securityProtocol: "TLSv1.3",
    errorInfo: "NoError",
    originName: "origin",
    originStatus: 200,
    ...p,
  };
}

function matches(r: AccessLogRecord, partial: Record<string, unknown>): boolean {
  const f: Filter = filterSchema.parse({ range: "90d", ...partial });
  // Wide window so non-time facets are what we exercise.
  const from = new Date("2000-01-01T00:00:00Z");
  const to = new Date("2100-01-01T00:00:00Z");
  return matchesFilter(r, f, buildMatchContext(f, from, to));
}

describe("compilePathPattern", () => {
  it("prefix matches both the bare path and host+path", () => {
    const p = compilePathPattern({ mode: "prefix", value: "/api" });
    expect(p.test("nadav.com", "/api/v1")).toBe(true);
    const p2 = compilePathPattern({ mode: "prefix", value: "nadav.com/api" });
    expect(p2.test("nadav.com", "/api/v1")).toBe(true);
    expect(p.test("nadav.com", "/health")).toBe(false);
  });

  it("exact requires a full match", () => {
    const p = compilePathPattern({ mode: "exact", value: "/api" });
    expect(p.test("nadav.com", "/api")).toBe(true);
    expect(p.test("nadav.com", "/api/v1")).toBe(false);
  });

  it("glob translates * and ?", () => {
    const p = compilePathPattern({ mode: "glob", value: "/api/*/quote" });
    expect(p.test("nadav.com", "/api/v1/quote")).toBe(true);
    expect(p.test("nadav.com", "/api/v1/v2/quote")).toBe(true);
    expect(p.test("nadav.com", "/api/quote")).toBe(false);
  });

  it("regex is case-insensitive and falls back to never-match when invalid", () => {
    expect(compilePathPattern({ mode: "regex", value: "QUOTE$" }).test("h", "/api/quote")).toBe(true);
    expect(compilePathPattern({ mode: "regex", value: "(" }).test("h", "/api")).toBe(false);
  });
});

describe("cidrMatch", () => {
  it("tests IPv4 membership", () => {
    expect(cidrMatch("203.0.113.7", "203.0.113.0/24")).toBe(true);
    expect(cidrMatch("203.0.114.7", "203.0.113.0/24")).toBe(false);
    expect(cidrMatch("8.8.8.8", "0.0.0.0/0")).toBe(true);
    expect(cidrMatch("not-an-ip", "203.0.113.0/24")).toBe(false);
  });
});

describe("matchesFilter", () => {
  it("excludes records outside the time window", () => {
    const f = filterSchema.parse({});
    const ctx = buildMatchContext(f, new Date("2026-06-01T00:00:00Z"), new Date("2026-06-02T00:00:00Z"));
    expect(matchesFilter(rec({ timestamp: "2026-06-01T12:00:00.000Z" }), f, ctx)).toBe(true);
    expect(matchesFilter(rec({ timestamp: "2025-01-01T00:00:00.000Z" }), f, ctx)).toBe(false);
  });

  it("applies equality facets", () => {
    expect(matches(rec({ country: "US" }), { country: ["US"] })).toBe(true);
    expect(matches(rec({ country: "US" }), { country: ["IL"] })).toBe(false);
    expect(matches(rec({ host: "a.com" }), { host: ["b.com"] })).toBe(false);
  });

  it("matches status by class and by exact code", () => {
    expect(matches(rec({ status: 404 }), { status: ["4xx"] })).toBe(true);
    expect(matches(rec({ status: 200 }), { status: ["4xx"] })).toBe(false);
    expect(matches(rec({ status: 503 }), { status: [503] })).toBe(true);
    expect(matches(rec({ status: 500 }), { status: [503] })).toBe(false);
  });

  it("supports CIDR membership", () => {
    expect(matches(rec({ clientIp: "203.0.113.9" }), { cidr: ["203.0.113.0/24"] })).toBe(true);
    expect(matches(rec({ clientIp: "10.0.0.1" }), { cidr: ["203.0.113.0/24"] })).toBe(false);
  });

  it("searches the free-text haystack", () => {
    expect(matches(rec({ userAgent: "curl/8.0" }), { q: "curl" })).toBe(true);
    expect(matches(rec({ asnOrg: "Hetzner" }), { q: "hetzner" })).toBe(true);
    expect(matches(rec(), { q: "absent-token" })).toBe(false);
  });

  it("ANDs path predicates and honours negation", () => {
    expect(matches(rec({ path: "/api/v1" }), { path: [{ mode: "prefix", value: "/api" }] })).toBe(true);
    expect(
      matches(rec({ path: "/admin" }), { path: [{ mode: "prefix", value: "/api", negate: true }] }),
    ).toBe(true);
    expect(
      matches(rec({ path: "/api/x" }), { path: [{ mode: "prefix", value: "/api", negate: true }] }),
    ).toBe(false);
  });
});

describe("matchesFilter - negation (not / Exclude)", () => {
  it("excludes a record matching a negated equality facet, passes others", () => {
    expect(matches(rec({ country: "US" }), { not: { country: ["US"] } })).toBe(false);
    expect(matches(rec({ country: "IL" }), { not: { country: ["US"] } })).toBe(true);
    expect(matches(rec({ host: "a.com" }), { not: { host: ["a.com"] } })).toBe(false);
    expect(matches(rec({ host: "b.com" }), { not: { host: ["a.com"] } })).toBe(true);
    expect(matches(rec({ clientIp: "1.2.3.4" }), { not: { clientIp: ["1.2.3.4"] } })).toBe(false);
  });

  it("ANDs multiple negated facets (excluded if it matches ANY)", () => {
    const f = { not: { country: ["US"], pop: ["LHR"] } };
    expect(matches(rec({ country: "US", pop: "LAX" }), f)).toBe(false); // hit on country
    expect(matches(rec({ country: "IL", pop: "LHR" }), f)).toBe(false); // hit on pop
    expect(matches(rec({ country: "IL", pop: "LAX" }), f)).toBe(true); // hits neither
  });

  it("negates referer with the (none) sentinel mapped to the empty string", () => {
    expect(matches(rec({ referer: "" }), { not: { referer: ["(none)"] } })).toBe(false);
    expect(matches(rec({ referer: "https://x" }), { not: { referer: ["(none)"] } })).toBe(true);
  });

  it("negates status by class and by exact code", () => {
    expect(matches(rec({ status: 404 }), { not: { status: ["4xx"] } })).toBe(false);
    expect(matches(rec({ status: 200 }), { not: { status: ["4xx"] } })).toBe(true);
    expect(matches(rec({ status: 503 }), { not: { status: [503] } })).toBe(false);
    expect(matches(rec({ status: 500 }), { not: { status: [503] } })).toBe(true);
  });
});

describe("buildMatchContext", () => {
  it("precompiles path predicates and normalizes q", () => {
    const f = filterSchema.parse({ path: [{ mode: "prefix", value: "/api" }], q: "  Foo " });
    const ctx = buildMatchContext(f, resolveTimeRange(f).from, resolveTimeRange(f).to);
    expect(ctx.pathPredicates).toHaveLength(1);
    expect(ctx.q).toBe("foo");
  });
});
