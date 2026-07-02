import { describe, expect, it } from "vitest";

import {
  MIN_RANGE_MS,
  clampRange,
  countActiveFacets,
  decodePathPattern,
  decodeStatus,
  emptyFilter,
  encodePathPattern,
  encodeStatus,
  filterFromSearchParams,
  filterSchema,
  filterToSearchParams,
  resolveTimeRange,
} from "@/lib/filters/model";

describe("filter URL (de)serialization", () => {
  it("round-trips a complex filter through search params", () => {
    const f = filterSchema.parse({
      range: "7d",
      host: ["nadav.com", "api.nadav.com"],
      country: ["US", "IL"],
      path: [
        { mode: "prefix", value: "/api", negate: false },
        { mode: "glob", value: "/v1/*", negate: true },
      ],
      status: ["4xx", 500],
      cidr: ["203.0.113.0/24"],
      deviceType: ["mobile", "bot"],
      q: "needle",
    });
    const back = filterFromSearchParams(filterToSearchParams(f));
    expect(back).toEqual(f);
  });

  it("omits defaults from the query string", () => {
    expect(filterToSearchParams(emptyFilter()).toString()).toBe("");
  });

  it("reads a plain record of strings too", () => {
    const f = filterFromSearchParams({ range: "1h", country: "US,IL", status: "5xx" });
    expect(f.range).toBe("1h");
    expect(f.country).toEqual(["US", "IL"]);
    expect(f.status).toEqual(["5xx"]);
  });

  it("falls back to an empty filter on invalid input", () => {
    const f = filterFromSearchParams({ range: "nonsense" });
    expect(f).toEqual(emptyFilter());
  });
});

describe("path pattern encoding", () => {
  it("encodes mode, value and negation", () => {
    expect(encodePathPattern({ mode: "regex", value: "^/x" })).toBe("regex:^/x");
    expect(encodePathPattern({ mode: "prefix", value: "/api", negate: true })).toBe("!prefix:/api");
  });

  it("decodes a bare value as a prefix match", () => {
    expect(decodePathPattern("/api")).toEqual({ mode: "prefix", value: "/api", negate: false });
  });

  it("decodes an unknown mode as prefix over the whole token", () => {
    expect(decodePathPattern("weird:/x")).toEqual({
      mode: "prefix",
      value: "weird:/x",
      negate: false,
    });
  });
});

describe("status encoding", () => {
  it("round-trips classes and exact codes", () => {
    expect(decodeStatus(encodeStatus("4xx"))).toBe("4xx");
    expect(decodeStatus(encodeStatus(503))).toBe(503);
    expect(decodeStatus("abc")).toBeNull();
  });
});

describe("countActiveFacets", () => {
  it("counts every non-time facet including path, status and search", () => {
    const f = filterSchema.parse({
      range: "24h",
      host: ["a", "b"],
      country: ["US"],
      path: [{ mode: "prefix", value: "/api" }],
      status: ["4xx"],
      q: "x",
    });
    expect(countActiveFacets(f)).toBe(2 + 1 + 1 + 1 + 1);
  });

  it("is zero for the empty filter", () => {
    expect(countActiveFacets(emptyFilter())).toBe(0);
  });
});

describe("resolveTimeRange", () => {
  it("uses an explicit custom window when from+to are set", () => {
    const { from, to } = resolveTimeRange(
      filterSchema.parse({ from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z" }),
    );
    expect(from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("derives the window from a preset relative to now", () => {
    const now = new Date("2026-06-18T12:00:00Z");
    const { from, to } = resolveTimeRange(filterSchema.parse({ range: "24h" }), now);
    expect(to).toEqual(now);
    expect(to.getTime() - from.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe("clampRange", () => {
  it("expands a zero-width range to the minimum span", () => {
    const t = "2026-01-01T00:00:00.000Z";
    const { from, to } = clampRange(t, t);
    expect(from).toBe(t);
    expect(Date.parse(to) - Date.parse(from)).toBe(MIN_RANGE_MS);
  });

  it("expands an inverted (to < from) range from `from`", () => {
    const from = "2026-01-01T00:05:00.000Z";
    const to = "2026-01-01T00:00:00.000Z";
    const r = clampRange(from, to);
    expect(r.from).toBe(from);
    expect(Date.parse(r.to) - Date.parse(r.from)).toBe(MIN_RANGE_MS);
  });

  it("expands a sub-minimum range (< 60s) to the minimum span", () => {
    const from = "2026-01-01T00:00:00.000Z";
    const to = "2026-01-01T00:00:30.000Z"; // 30s < 60s
    const r = clampRange(from, to);
    expect(r.from).toBe(from);
    expect(Date.parse(r.to) - Date.parse(r.from)).toBe(MIN_RANGE_MS);
  });

  it("leaves an already-wide range untouched", () => {
    const from = "2026-01-01T00:00:00.000Z";
    const to = "2026-01-02T00:00:00.000Z";
    expect(clampRange(from, to)).toEqual({ from, to });
  });

  it("respects a custom minimum span", () => {
    const from = "2026-01-01T00:00:00.000Z";
    const r = clampRange(from, from, 5 * 60_000);
    expect(Date.parse(r.to) - Date.parse(r.from)).toBe(5 * 60_000);
  });

  it("passes unparseable input through untouched", () => {
    expect(clampRange("not-a-date", "also-bad")).toEqual({
      from: "not-a-date",
      to: "also-bad",
    });
  });
});
