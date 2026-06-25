import type { AccessLogRecord } from "@/lib/domain/types";
import { statusClass } from "@/lib/domain/types";
import type { Filter, PathPattern, StatusFilter } from "@/lib/filters/model";

/**
 * Reference filtering semantics applied in-memory by the mock data source.
 * The ClickHouse/KQL compilers added later MUST reproduce these semantics.
 */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Convert a URL glob (`*` = any chars, `?` = one char) to a RegExp. */
function globToRegExp(glob: string): RegExp {
  let out = "";
  for (const ch of glob) {
    if (ch === "*") out += ".*";
    else if (ch === "?") out += ".";
    else out += escapeRegex(ch);
  }
  return new RegExp(`^${out}$`, "i");
}

export interface PathPredicate {
  test: (host: string, path: string) => boolean;
  negate: boolean;
}

/**
 * Compile a path pattern into a predicate. Patterns are matched against BOTH
 * the bare path (`/api`) and the host+path (`nadav.com/api`), so any of
 * `/api`, `api`, `nadav.com/api`, `*.com/api/*` work intuitively.
 */
export function compilePathPattern(p: PathPattern): PathPredicate {
  const value = p.value.trim();
  const negate = p.negate ?? false;

  if (p.mode === "regex") {
    let re: RegExp;
    try {
      re = new RegExp(value, "i");
    } catch {
      re = /$a/; // never matches on invalid regex
    }
    return {
      negate,
      test: (host, path) => re.test(path) || re.test(`${host}${path}`),
    };
  }

  if (p.mode === "glob") {
    const re = globToRegExp(value);
    return {
      negate,
      test: (host, path) => re.test(path) || re.test(`${host}${path}`),
    };
  }

  const needle = value.toLowerCase();

  if (p.mode === "exact") {
    return {
      negate,
      test: (host, path) =>
        path.toLowerCase() === needle || `${host}${path}`.toLowerCase() === needle,
    };
  }

  // prefix (default) - match against the path and the host+path
  return {
    negate,
    test: (host, path) =>
      path.toLowerCase().startsWith(needle) || `${host}${path}`.toLowerCase().startsWith(needle),
  };
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

/** IPv4 CIDR membership test (e.g. "203.0.113.0/24"). */
export function cidrMatch(ip: string, cidr: string): boolean {
  const [range, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    return false;
  }
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

function statusMatches(status: number, filters: StatusFilter[]): boolean {
  if (filters.length === 0) return true;
  const cls = statusClass(status);
  for (const f of filters) {
    if (typeof f === "number") {
      if (status === f) return true;
    } else if (f === cls) {
      return true;
    }
  }
  return false;
}

export interface MatchContext {
  from: number; // epoch ms
  to: number; // epoch ms
  pathPredicates: PathPredicate[];
  q?: string;
}

/** Precompute reusable pieces of a filter for a tight matching loop. */
export function buildMatchContext(f: Filter, from: Date, to: Date): MatchContext {
  return {
    from: from.getTime(),
    to: to.getTime(),
    pathPredicates: f.path.map(compilePathPattern),
    q: f.q?.toLowerCase().trim() || undefined,
  };
}

export function matchesFilter(r: AccessLogRecord, f: Filter, ctx: MatchContext): boolean {
  const t = Date.parse(r.timestamp);
  if (t < ctx.from || t > ctx.to) return false;

  if (f.host.length && !f.host.includes(r.host)) return false;
  if (f.country.length && !f.country.includes(r.country)) return false;
  if (f.city.length && !f.city.includes(r.city)) return false;
  if (f.asnOrg.length && !f.asnOrg.includes(r.asnOrg)) return false;
  if (f.clientIp.length && !f.clientIp.includes(r.clientIp)) return false;
  if (f.method.length && !f.method.includes(r.method)) return false;
  if (f.uaFamily.length && !f.uaFamily.includes(r.uaFamily)) return false;
  if (f.deviceType.length && !f.deviceType.includes(r.deviceType)) return false;
  if (f.pop.length && !f.pop.includes(r.pop)) return false;
  if (f.cacheStatus.length && !f.cacheStatus.includes(r.cacheStatus)) return false;
  if (f.ja4.length && !f.ja4.includes(r.ja4)) return false;
  if (f.referer.length && !f.referer.includes(r.referer)) return false;

  if (!statusMatches(r.status, f.status)) return false;

  // Negated facets ("Exclude"): drop the record if it matches ANY non-empty
  // `not.<facet>` - the positive rule, negated (logical AND of "NOT in set").
  const n = f.not;
  if (n) {
    if (n.host?.length && n.host.includes(r.host)) return false;
    if (n.country?.length && n.country.includes(r.country)) return false;
    if (n.city?.length && n.city.includes(r.city)) return false;
    if (n.asnOrg?.length && n.asnOrg.includes(r.asnOrg)) return false;
    if (n.clientIp?.length && n.clientIp.includes(r.clientIp)) return false;
    if (n.method?.length && n.method.includes(r.method)) return false;
    if (n.uaFamily?.length && n.uaFamily.includes(r.uaFamily)) return false;
    if (n.deviceType?.length && n.deviceType.includes(r.deviceType)) return false;
    if (n.pop?.length && n.pop.includes(r.pop)) return false;
    if (n.cacheStatus?.length && n.cacheStatus.includes(r.cacheStatus)) return false;
    if (n.ja4?.length && n.ja4.includes(r.ja4)) return false;
    if (n.referer?.length && n.referer.map((x) => (x === "(none)" ? "" : x)).includes(r.referer))
      return false;
    if (n.status?.length && statusMatches(r.status, n.status)) return false;
  }

  if (f.cidr.length) {
    let ok = false;
    for (const c of f.cidr) {
      if (cidrMatch(r.clientIp, c)) {
        ok = true;
        break;
      }
    }
    if (!ok) return false;
  }

  // Path predicates: each pattern must be satisfied (AND). A negated pattern
  // passes when it does NOT match.
  for (const pred of ctx.pathPredicates) {
    const hit = pred.test(r.host, r.path);
    if (pred.negate ? hit : !hit) return false;
  }

  if (ctx.q) {
    const hay = `${r.url} ${r.userAgent} ${r.clientIp} ${r.referer} ${r.asnOrg} ${r.city} ${r.countryName}`.toLowerCase();
    if (!hay.includes(ctx.q)) return false;
  }

  return true;
}
