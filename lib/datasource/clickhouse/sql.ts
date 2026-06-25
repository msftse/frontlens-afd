import type { Dimension } from "@/lib/domain/types";
import type { Filter, PathPattern } from "@/lib/filters/model";

/**
 * Compiles the canonical Filter model into ClickHouse SQL. Semantics mirror
 * `lib/filters/match.ts` (the mock reference) so results are identical across
 * adapters. All user values go through parameter placeholders to prevent
 * injection; only integer literals we control (buckets, depth) are inlined.
 */

export const CACHE_HIT = "cacheStatus IN ('HIT','REMOTE_HIT','PARTIAL_HIT')";
export const CACHE_CONSIDERED = "cacheStatus IN ('HIT','REMOTE_HIT','PARTIAL_HIT','MISS')";

/** Accumulates a parameterized WHERE clause. */
export class SqlBuilder {
  private i = 0;
  readonly params: Record<string, unknown> = {};
  private conds: string[] = [];

  param(type: string, value: unknown): string {
    const name = `p${this.i++}`;
    this.params[name] = value;
    return `{${name}:${type}}`;
  }

  push(cond: string) {
    this.conds.push(cond);
  }

  inList(col: string, values: readonly string[], type = "String") {
    if (values.length) this.push(`${col} IN ${this.param(`Array(${type})`, values)}`);
  }

  notInList(col: string, values: readonly string[], type = "String") {
    if (values.length) this.push(`${col} NOT IN ${this.param(`Array(${type})`, values)}`);
  }

  where(): string {
    return this.conds.length ? this.conds.join(" AND ") : "1";
  }
}

function escapeRe2(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRe2(glob: string): string {
  let out = "";
  for (const ch of glob) {
    if (ch === "*") out += ".*";
    else if (ch === "?") out += ".";
    else out += escapeRe2(ch);
  }
  return `(?i)^${out}$`;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = (n << 8) | o;
  }
  return n >>> 0;
}

export function cidrRange(cidr: string): { start: number; end: number } | null {
  const [range, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  const base = ipv4ToInt(range);
  if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  if (bits === 0) return { start: 0, end: 0xffffffff };
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  const start = (base & mask) >>> 0;
  const end = (start | (~mask >>> 0)) >>> 0;
  return { start, end };
}

function pathCondition(s: SqlBuilder, p: PathPattern): string {
  const value = p.value.trim();

  if (p.mode === "regex" || p.mode === "glob") {
    const re = p.mode === "glob" ? globToRe2(value) : `(?i)${value}`;
    const ph = s.param("String", re);
    return `(match(path, ${ph}) OR match(hostPath, ${ph}))`;
  }

  // exact / prefix - match against the path and the host+path (mirrors match.ts)
  const needle = s.param("String", value.toLowerCase());
  return p.mode === "exact"
    ? `(lowerUTF8(path) = ${needle} OR lowerUTF8(hostPath) = ${needle})`
    : `(startsWith(lowerUTF8(path), ${needle}) OR startsWith(lowerUTF8(hostPath), ${needle}))`;
}

/** Adds all filter facets to the builder for a resolved [from, to] window. */
export function applyFilter(s: SqlBuilder, f: Filter, from: Date, to: Date) {
  s.push(`timestamp >= fromUnixTimestamp64Milli(${s.param("Int64", from.getTime())})`);
  s.push(`timestamp <= fromUnixTimestamp64Milli(${s.param("Int64", to.getTime())})`);

  s.inList("host", f.host);
  s.inList("country", f.country);
  s.inList("city", f.city);
  s.inList("asnOrg", f.asnOrg);
  s.inList("clientIp", f.clientIp);
  s.inList("method", f.method);
  s.inList("uaFamily", f.uaFamily);
  s.inList("deviceType", f.deviceType);
  s.inList("pop", f.pop);
  s.inList("cacheStatus", f.cacheStatus);
  s.inList("ja4", f.ja4);
  if (f.referer.length) {
    s.inList(
      "referer",
      f.referer.map((r) => (r === "(none)" ? "" : r)),
    );
  }

  if (f.status.length) {
    const parts = f.status.map((st) =>
      typeof st === "number"
        ? `status = ${s.param("UInt16", st)}`
        : `statusClass = ${s.param("UInt8", Number(st[0]))}`,
    );
    s.push(`(${parts.join(" OR ")})`);
  }

  // Negated facets ("Exclude"): mirror the positive facets, negated (NOT IN /
  // NOT (...)). The minute rollup can't express these - see canUseTrafficRollup.
  const n = f.not;
  if (n) {
    if (n.host?.length) s.notInList("host", n.host);
    if (n.city?.length) s.notInList("city", n.city);
    if (n.country?.length) s.notInList("country", n.country);
    if (n.asnOrg?.length) s.notInList("asnOrg", n.asnOrg);
    if (n.clientIp?.length) s.notInList("clientIp", n.clientIp);
    if (n.method?.length) s.notInList("method", n.method);
    if (n.uaFamily?.length) s.notInList("uaFamily", n.uaFamily);
    if (n.deviceType?.length) s.notInList("deviceType", n.deviceType);
    if (n.pop?.length) s.notInList("pop", n.pop);
    if (n.cacheStatus?.length) s.notInList("cacheStatus", n.cacheStatus);
    if (n.ja4?.length) s.notInList("ja4", n.ja4);
    if (n.referer?.length) {
      s.notInList(
        "referer",
        n.referer.map((r) => (r === "(none)" ? "" : r)),
      );
    }
    if (n.status?.length) {
      const parts = n.status.map((st) =>
        typeof st === "number"
          ? `status = ${s.param("UInt16", st)}`
          : `statusClass = ${s.param("UInt8", Number(st[0]))}`,
      );
      s.push(`NOT (${parts.join(" OR ")})`);
    }
  }

  if (f.cidr.length) {
    const parts: string[] = [];
    for (const c of f.cidr) {
      const r = cidrRange(c);
      if (r) {
        parts.push(
          `(clientIpNum BETWEEN ${s.param("UInt32", r.start)} AND ${s.param("UInt32", r.end)})`,
        );
      }
    }
    if (parts.length) s.push(`(${parts.join(" OR ")})`);
  }

  for (const p of f.path) {
    const cond = pathCondition(s, p);
    s.push(p.negate ? `NOT (${cond})` : `(${cond})`);
  }

  if (f.q) {
    const hay =
      "concat(url,' ',userAgent,' ',clientIp,' ',referer,' ',asnOrg,' ',city,' ',countryName)";
    s.push(`positionCaseInsensitiveUTF8(${hay}, ${s.param("String", f.q)}) > 0`);
  }
}

/**
 * True when the active filter only touches dimensions the traffic rollup
 * (`afd.rollup_traffic_1m`) carries: time, host, country, cacheStatus, and HTTP
 * status *class*. Any other facet (path, IP, UA, exact status code, free-text…)
 * forces a raw-table scan instead.
 */
export function canUseTrafficRollup(f: Filter): boolean {
  // Any negation ("Exclude") forces a raw scan - the rollup can't express it.
  if (f.not && Object.values(f.not).some((arr) => arr && arr.length > 0)) {
    return false;
  }
  if (
    f.path.length ||
    f.clientIp.length ||
    f.cidr.length ||
    f.city.length ||
    f.asnOrg.length ||
    f.method.length ||
    f.uaFamily.length ||
    f.deviceType.length ||
    f.pop.length ||
    f.ja4.length ||
    f.referer.length ||
    (f.q != null && f.q.trim() !== "")
  ) {
    return false;
  }
  // The rollup stores statusClass, not exact status codes.
  return !f.status.some((st) => typeof st === "number");
}

/**
 * WHERE builder for the traffic rollup. Mirrors the supported subset of
 * `applyFilter`, ranging over the minute `bucket` column and only the
 * dimensions the rollup carries. Assumes `canUseTrafficRollup(f)` is true.
 */
export function applyRollupFilter(s: SqlBuilder, f: Filter, from: Date, to: Date) {
  s.push(`bucket >= fromUnixTimestamp64Milli(${s.param("Int64", from.getTime())})`);
  s.push(`bucket <= fromUnixTimestamp64Milli(${s.param("Int64", to.getTime())})`);
  s.inList("host", f.host);
  s.inList("country", f.country);
  s.inList("cacheStatus", f.cacheStatus);
  if (f.status.length) {
    const parts = f.status
      .filter((st): st is "2xx" | "3xx" | "4xx" | "5xx" => typeof st !== "number")
      .map((st) => `statusClass = ${s.param("UInt8", Number(st[0]))}`);
    if (parts.length) s.push(`(${parts.join(" OR ")})`);
  }
}

/** key + label SQL expressions for a Top-N dimension (mirrors mock dimValue). */
export function dimExpr(d: Dimension): { key: string; label: string } {
  switch (d) {
    case "country":
      return { key: "country", label: "countryName" };
    case "city":
      return { key: "city", label: "concat(city, ', ', country)" };
    case "asnOrg":
      return { key: "asnOrg", label: "asnOrg" };
    case "clientIp":
      return { key: "clientIp", label: "clientIp" };
    case "host":
      return { key: "host", label: "host" };
    case "path":
      return { key: "hostPath", label: "hostPath" };
    case "status":
      return { key: "toString(status)", label: "toString(status)" };
    case "statusClass":
      return { key: "concat(toString(statusClass),'xx')", label: "concat(toString(statusClass),'xx')" };
    case "method":
      return { key: "method", label: "method" };
    case "uaFamily":
      return { key: "uaFamily", label: "uaFamily" };
    case "deviceType":
      return { key: "deviceType", label: "deviceType" };
    case "pop":
      return { key: "pop", label: "pop" };
    case "cacheStatus":
      return { key: "cacheStatus", label: "cacheStatus" };
    case "referer":
      return { key: "if(referer='','(none)',referer)", label: "if(referer='','(direct)',referer)" };
    case "ja4":
      return { key: "ja4", label: "ja4" };
    case "errorInfo":
      return { key: "errorInfo", label: "errorInfo" };
  }
}

/** Group-by expression for the Path Explorer, trimming to `depth` segments. */
export function pathGroupExpr(depth: number): string {
  const d = Math.max(0, Math.min(6, Math.floor(depth)));
  if (d === 0) return "path";
  return (
    `if(length(arrayFilter(x -> x != '', splitByChar('/', path))) <= ${d}, path, ` +
    `concat('/', arrayStringConcat(arraySlice(arrayFilter(x -> x != '', splitByChar('/', path)), 1, ${d}), '/')))`
  );
}

export function autoBucketSeconds(spanSeconds: number, targetPoints = 150): number {
  const nice = [60, 300, 900, 1800, 3600, 10800, 21600, 43200, 86400, 604800];
  const ideal = spanSeconds / targetPoints;
  for (const b of nice) if (b >= ideal) return b;
  return nice[nice.length - 1];
}
