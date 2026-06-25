import { describe, expect, it } from "vitest";

import { filterSchema } from "@/lib/filters/model";
import {
  baseProjection,
  dimExpr,
  geoProjection,
  kstr,
  pathGroupExpr,
  validCidr,
  whereFor,
} from "@/lib/datasource/loganalytics/kql";
import { countryNameToIso2, iso2ToCountryNames } from "@/lib/datasource/loganalytics/countries";

/**
 * No-DB validation of the KQL compiler: asserts the generated Kusto mirrors the
 * mock matcher's semantics and safely escapes user input. Parallels
 * scripts/check-sql.ts for the ClickHouse compiler.
 */

const f = filterSchema.parse({
  range: "7d",
  host: ["nadav.com"],
  country: ["US", "IL"],
  path: [
    { mode: "regex", value: "a{1,3}" }, // comma inside a single value
    { mode: "prefix", value: "nadav.com/api" },
    { mode: "glob", value: "/api/*" },
  ],
  status: ["4xx", 500],
  cidr: ["203.0.113.0/24"],
  q: 'foo,bar"baz',
});

const { conds } = whereFor(f);
const where = conds.join(" and ");

describe("kql filter compiler", () => {
  it("bounds time with datetime() on TimeGenerated", () => {
    expect(where).toContain("TimeGenerated >= datetime(");
    expect(where).toContain("TimeGenerated <= datetime(");
  });

  it("expands ISO-2 country filter to AFD full names", () => {
    // US/IL → must reference the names AFD reports, not the codes.
    expect(where).toContain("countryName in (");
    expect(where).toContain(kstr("United States"));
    expect(where).toContain(kstr("Israel"));
  });

  it("matches prefix against BOTH path and host+path", () => {
    expect(where).toMatch(/tolower\(path\) startswith .* or tolower\(hostPath\) startswith/);
  });

  it("uses matches regex for glob/regex on path and hostPath", () => {
    expect(where).toMatch(/path matches regex .* or hostPath matches regex/);
  });

  it("keeps a regex value containing a comma as one literal", () => {
    expect(where).toContain('@"(?i)a{1,3}"');
  });

  it("emits status class and exact predicates", () => {
    expect(where).toContain("statusClass == 4");
    expect(where).toContain("statusNum == 500");
  });

  it("compiles CIDR via ipv4_is_in_range", () => {
    expect(where).toContain('ipv4_is_in_range(clientIp, "203.0.113.0/24")');
  });

  it("escapes embedded quotes in free-text q (injection-safe)", () => {
    // The double-quote in q must be backslash-escaped inside the KQL literal.
    expect(where).toContain('foo,bar\\"baz');
    // And there must be no unescaped break in the string literal.
    expect(where).toContain("contains ");
  });
});

describe("kql string escaping", () => {
  it("wraps and escapes backslashes and quotes", () => {
    expect(kstr('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});

describe("kql negation (not / Exclude)", () => {
  it("emits !in for negated string facets", () => {
    const f2 = filterSchema.parse({ range: "7d", not: { host: ["a.com"], clientIp: ["1.2.3.4"] } });
    const w = whereFor(f2).conds.join(" and ");
    expect(w).toContain(`host !in (${kstr("a.com")})`);
    expect(w).toContain(`clientIp !in (${kstr("1.2.3.4")})`);
  });

  it("expands a negated ISO-2 country to AFD names via countryName !in", () => {
    const f2 = filterSchema.parse({ range: "7d", not: { country: ["US"] } });
    const w = whereFor(f2).conds.join(" and ");
    expect(w).toContain("countryName !in (");
    expect(w).toContain(kstr("United States"));
  });

  it("maps the negated referer (none) sentinel to the empty string", () => {
    const f2 = filterSchema.parse({ range: "7d", not: { referer: ["(none)"] } });
    const w = whereFor(f2).conds.join(" and ");
    expect(w).toContain(`referer !in (${kstr("")})`);
  });

  it("negates status with not ( ... ), class and exact", () => {
    const f2 = filterSchema.parse({ range: "7d", not: { status: ["4xx", 500] } });
    const w = whereFor(f2).conds.join(" and ");
    expect(w).toContain("not (");
    expect(w).toContain("statusClass == 4");
    expect(w).toContain("statusNum == 500");
  });
});

describe("kql injection safety", () => {
  it("neutralizes a quote-breakout attempt in a regex path value", () => {
    const evil = filterSchema.parse({
      range: "7d",
      path: [{ mode: "regex", value: 'x" or hostPath contains "admin' }],
    });
    const where = whereFor(evil).conds.join(" and ");
    // The injected double-quotes must be backslash-escaped inside the @"..." literal,
    // so the ` or hostPath contains ` never becomes live KQL operators.
    expect(where).toContain('\\"');
    expect(where).not.toMatch(/regex @"x" or hostPath contains "admin"/);
  });

  it("keeps a free-text value with quotes/pipes inside one string literal", () => {
    const evil = filterSchema.parse({ range: "7d", q: 'a" | take 1 //' });
    const where = whereFor(evil).conds.join(" and ");
    expect(where).toContain('a\\" | take 1 //');
    // No bare `| take` outside the quoted literal.
    expect(where).not.toMatch(/contains "a" \| take 1/);
  });

  it("only emits ipv4_is_in_range for well-formed CIDRs", () => {
    const f2 = filterSchema.parse({ range: "7d", cidr: ["10.0.0.0/8", "bogus/99", '1.1.1.1") or true//'] });
    const where = whereFor(f2).conds.join(" and ");
    expect(where).toContain('ipv4_is_in_range(clientIp, "10.0.0.0/8")');
    expect(where).not.toContain("bogus");
    expect(where).not.toContain("or true");
  });
});

describe("kql dimensions", () => {
  it("country dimension keys on the country name (adapter maps to ISO-2)", () => {
    expect(dimExpr("country").key).toBe("countryName");
  });
  it("path dimension groups by hostPath", () => {
    expect(dimExpr("path").key).toBe("hostPath");
  });
  it("city dimension requires geo enrichment", () => {
    expect(dimExpr("city").needsGeo).toBe(true);
  });
});

describe("kql path grouping", () => {
  it("depth 0 is the raw path", () => {
    expect(pathGroupExpr(0)).toBe("path");
  });
  it("depth 2 trims via extract_all + array_slice", () => {
    const e = pathGroupExpr(2);
    expect(e).toContain("extract_all");
    expect(e).toContain("array_slice");
    expect(e).toContain(", 0, 2)");
  });
});

describe("kql cidr validation", () => {
  it("accepts a valid v4 CIDR", () => {
    expect(validCidr("203.0.113.0/24")).toBe("203.0.113.0/24");
  });
  it("rejects malformed CIDRs", () => {
    expect(validCidr("999.0.0.0/24")).toBeNull();
    expect(validCidr("10.0.0.0/40")).toBeNull();
    expect(validCidr("nope")).toBeNull();
  });
});

describe("base + geo projections", () => {
  it("base projection normalizes AFD columns to typed names", () => {
    const b = baseProjection();
    expect(b).toContain("statusNum = toint(httpStatusCode_s)");
    expect(b).toContain("ms = todouble(timeTaken_s) * 1000.0");
    expect(b).toContain("path = iff(isempty(_path)");
    expect(b).toContain("statusClass = case(");
    expect(b).toContain("asnOrg = '—'");
  });
  it("geo projection derives city/lat/lon from geo_info", () => {
    const g = geoProjection();
    expect(g).toContain("geo_info_from_ip_address(clientIp)");
    expect(g).toContain("city = tostring(_geo.city)");
  });
});

describe("country mapping", () => {
  it("maps AFD names to ISO-2", () => {
    expect(countryNameToIso2("United States")).toBe("US");
    expect(countryNameToIso2("Israel")).toBe("IL");
    expect(countryNameToIso2("Netherlands")).toBe("NL");
  });
  it("handles Azure alias spellings", () => {
    expect(countryNameToIso2("Russian Federation")).toBe("RU");
    expect(countryNameToIso2("Viet Nam")).toBe("VN");
  });
  it("passes through ISO-2 input and blanks empties", () => {
    expect(countryNameToIso2("US")).toBe("US");
    expect(countryNameToIso2("")).toBe("");
    expect(countryNameToIso2(null)).toBe("");
  });
  it("expands an ISO-2 to the names to match in KQL", () => {
    expect(iso2ToCountryNames("US")).toContain("United States");
    expect(iso2ToCountryNames("RU")).toContain("Russia");
  });
});
