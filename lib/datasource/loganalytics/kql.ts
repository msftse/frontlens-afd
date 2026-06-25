import type { Dimension } from "@/lib/domain/types";
import type { Filter, PathPattern } from "@/lib/filters/model";
import { resolveTimeRange } from "@/lib/filters/model";
import { iso2ToCountryNames } from "@/lib/datasource/loganalytics/countries";

/**
 * Compiles the canonical Filter model into Kusto (KQL) for Azure Log Analytics.
 *
 * Semantics mirror `lib/filters/match.ts` (the mock reference) and
 * `lib/datasource/clickhouse/sql.ts` so results are identical across adapters.
 *
 * Azure Front Door Standard/Premium access logs land in the legacy
 * `AzureDiagnostics` table (Category == 'FrontDoorAccessLog'), where every
 * field is a string suffixed `_s`/`_d`/… So we first project a normalized,
 * typed row (see {@link baseProjection}); all later stages reference those
 * clean column names — never the raw `*_s` fields.
 *
 * There is no parameter-binding API for the Logs Query client, so every
 * user-supplied value is escaped via {@link kstr} (KQL string literal) before
 * being inlined. Only integers we control (buckets, depth, limits) are inlined
 * directly.
 */

export const TABLE = "AzureDiagnostics";
export const CATEGORY = "FrontDoorAccessLog";

/** Cache-status groupings (mirror clickhouse/sql.ts + match.ts). */
const CACHE_HIT = `cacheStatus in ("HIT","REMOTE_HIT","PARTIAL_HIT")`;
const CACHE_CONSIDERED = `cacheStatus in ("HIT","REMOTE_HIT","PARTIAL_HIT","MISS")`;
export { CACHE_HIT, CACHE_CONSIDERED };

/** Escape a value as a KQL string literal: wrap in quotes, backslash-escape. */
export function kstr(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Escape a bare string for use inside a larger KQL string (no surrounding quotes). */
function kraw(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * The normalized projection applied right after the table/category/time filter.
 * Maps the raw AFD `AzureDiagnostics` columns to the clean names the rest of the
 * compiler and the adapter rely on. Verified against live data 2026-06-21.
 */
export function baseProjection(): string {
  return [
    "| extend",
    "    _path = tostring(parse_url(requestUri_s).Path),",
    "    statusNum = toint(httpStatusCode_s),",
    "    ms = todouble(timeTaken_s) * 1000.0,",
    "    respBytes = tolong(responseBytes_s),",
    "    reqBytes = tolong(requestBytes_s),",
    "    countryName = tostring(clientCountry_s)",
    "| extend",
    "    host = tostring(hostName_s),",
    "    path = iff(isempty(_path), '/', _path),",
    "    clientIp = tostring(clientIp_s),",
    "    method = tostring(httpMethod_s),",
    "    cacheStatus = toupper(tostring(cacheStatus_s)),",
    "    pop = tostring(pop_s),",
    "    ja4 = tostring(clientJA4FingerPrint_s),",
    "    userAgent = tostring(userAgent_s),",
    "    referer = tostring(column_ifexists('referer_s', '')),",
    "    securityProtocol = tostring(securityProtocol_s),",
    "    errorInfo = tostring(errorInfo_s)",
    "| extend",
    "    statusClass = case(statusNum >= 200 and statusNum < 300, 2,",
    "                       statusNum >= 300 and statusNum < 400, 3,",
    "                       statusNum >= 400 and statusNum < 500, 4,",
    "                       statusNum >= 500 and statusNum < 600, 5, 0),",
    "    hostPath = strcat(tostring(hostName_s), iff(isempty(_path), '/', _path)),",
    // Best-effort device class from the UA string (AFD carries no device field).
    "    deviceType = case(userAgent matches regex @'(?i)bot|crawler|spider|curl|wget|python-requests', 'bot',",
    "                      userAgent matches regex @'(?i)mobile|android|iphone|ipod', 'mobile',",
    "                      userAgent matches regex @'(?i)ipad|tablet', 'tablet', 'desktop')",
    // Fields AFD logs don't carry — kept as constants so projections stay uniform.
    "| extend asn = 0, asnOrg = '—', uaFamily = '', uaOs = ''",
  ].join("\n");
}

/**
 * Geo enrichment projection. AFD logs carry the country *name* but no city /
 * coordinates, so we derive those from the client IP via KQL's built-in
 * `geo_info_from_ip_address()`. Appended ONLY by views that need city/lat/lon
 * (geography, visitor detail) to avoid the per-row cost on every query.
 * Defines: `city`, `latitude`, `longitude`. The country name still comes from
 * `clientCountry_s` (cheaper, already present) and the adapter maps it to ISO-2.
 */
export function geoProjection(): string {
  return [
    "| extend _geo = geo_info_from_ip_address(clientIp)",
    "| extend",
    "    city = tostring(_geo.city),",
    "    latitude = todouble(_geo.latitude),",
    "    longitude = todouble(_geo.longitude)",
  ].join("\n");
}

/** Convert a URL glob (`*` any, `?` one) to an RE2 pattern (anchored, case-insensitive). */
function globToRe2(glob: string): string {
  let out = "";
  for (const ch of glob) {
    if (ch === "*") out += ".*";
    else if (ch === "?") out += ".";
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return `(?i)^${out}$`;
}

/** IPv4 → 32-bit int (returns null on malformed input). */
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

/** Validate a "203.0.113.0/24" CIDR; returns it normalized or null if invalid. */
export function validCidr(cidr: string): string | null {
  const [range, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  if (ipv4ToInt(range) === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  return `${range}/${bits}`;
}

/** A single path pattern → KQL boolean expression (matches path AND host+path). */
function pathCondition(p: PathPattern): string {
  const value = p.value.trim();

  if (p.mode === "regex" || p.mode === "glob") {
    const re = p.mode === "glob" ? globToRe2(value) : `(?i)${value}`;
    const lit = `@"${kraw(re)}"`;
    return `(path matches regex ${lit} or hostPath matches regex ${lit})`;
  }

  const needle = value.toLowerCase();
  if (p.mode === "exact") {
    return `(tolower(path) == ${kstr(needle)} or tolower(hostPath) == ${kstr(needle)})`;
  }
  // prefix (default)
  return `(tolower(path) startswith ${kstr(needle)} or tolower(hostPath) startswith ${kstr(needle)})`;
}

/**
 * Time-window predicates on the RAW `TimeGenerated` column. Applied BEFORE
 * baseProjection() so Log Analytics can prune by ingestion time (it bills per
 * GB scanned). Kept separate from the facet predicates, which must run AFTER
 * the projection that introduces the clean column names they reference.
 */
export function timeConditions(from: Date, to: Date): string[] {
  return [
    `TimeGenerated >= datetime(${from.toISOString()})`,
    `TimeGenerated <= datetime(${to.toISOString()})`,
  ];
}

/**
 * Facet `where` predicates (host, country, clientIp, path, status, …). These
 * reference the CLEAN names introduced by {@link baseProjection} (e.g. `host`,
 * `clientIp`, `countryName`, `path`, `statusClass`), so callers MUST emit them
 * AFTER baseProjection — not in the same pre-projection `where` as the time
 * bound. Mirrors `applyFilter` in clickhouse/sql.ts.
 */
export function facetConditions(f: Filter): string[] {
  const c: string[] = [];

  const inList = (col: string, values: readonly string[]) => {
    if (values.length) c.push(`${col} in (${values.map((v) => kstr(v)).join(", ")})`);
  };

  inList("host", f.host);
  // country filter keys on ISO-2; AFD reports full names → expand to names.
  if (f.country.length) {
    const names = f.country.flatMap((iso) => iso2ToCountryNames(iso));
    c.push(`countryName in (${names.map((v) => kstr(v)).join(", ")})`);
  }
  inList("clientIp", f.clientIp);
  inList("method", f.method);
  inList("deviceType", f.deviceType);
  inList("pop", f.pop);
  inList("cacheStatus", f.cacheStatus);
  inList("ja4", f.ja4);
  if (f.referer.length) {
    inList(
      "referer",
      f.referer.map((r) => (r === "(none)" ? "" : r)),
    );
  }

  if (f.status.length) {
    const parts = f.status.map((st) =>
      typeof st === "number" ? `statusNum == ${Math.trunc(st)}` : `statusClass == ${Number(st[0])}`,
    );
    c.push(`(${parts.join(" or ")})`);
  }

  // Negated facets ("Exclude"): mirror the supported positive facets, negated
  // (`!in` / `not (...)`). Like the positive side, city/asnOrg/uaFamily are not
  // expressible against AFD logs (constants / geo-only), so they're omitted.
  const n = f.not;
  if (n) {
    const notInList = (col: string, values: readonly string[] | undefined) => {
      if (values?.length) c.push(`${col} !in (${values.map((v) => kstr(v)).join(", ")})`);
    };
    notInList("host", n.host);
    if (n.country?.length) {
      const names = n.country.flatMap((iso) => iso2ToCountryNames(iso));
      c.push(`countryName !in (${names.map((v) => kstr(v)).join(", ")})`);
    }
    notInList("clientIp", n.clientIp);
    notInList("method", n.method);
    notInList("deviceType", n.deviceType);
    notInList("pop", n.pop);
    notInList("cacheStatus", n.cacheStatus);
    notInList("ja4", n.ja4);
    if (n.referer?.length) {
      notInList(
        "referer",
        n.referer.map((r) => (r === "(none)" ? "" : r)),
      );
    }
    if (n.status?.length) {
      const parts = n.status.map((st) =>
        typeof st === "number"
          ? `statusNum == ${Math.trunc(st)}`
          : `statusClass == ${Number(st[0])}`,
      );
      c.push(`not (${parts.join(" or ")})`);
    }
  }

  if (f.cidr.length) {
    const parts: string[] = [];
    for (const cidr of f.cidr) {
      const v = validCidr(cidr);
      if (v) parts.push(`ipv4_is_in_range(clientIp, ${kstr(v)})`);
    }
    if (parts.length) c.push(`(${parts.join(" or ")})`);
  }

  for (const p of f.path) {
    const cond = pathCondition(p);
    c.push(p.negate ? `not (${cond})` : `(${cond})`);
  }

  if (f.q) {
    // Free-text over the fields available in LA. Mirrors match.ts
    // (url/userAgent/clientIp/referer/countryName); AFD has no asnOrg, and city
    // needs geo enrichment so isn't searched here. requestUri_s is the FULL url
    // (path + query), so query-string and host matches both work.
    const fields = `strcat(requestUri_s, " ", clientIp, " ", userAgent, " ", referer, " ", countryName)`;
    c.push(`${fields} contains ${kstr(f.q)}`);
  }

  return c;
}

/**
 * Full predicate list (time + facets) as one array. Retained for callers and
 * tests that want the whole set; the adapter applies the two halves separately
 * (time pre-projection, facets post-projection) via {@link timeConditions} and
 * {@link facetConditions}.
 */
export function filterConditions(f: Filter, from: Date, to: Date): string[] {
  return [...timeConditions(from, to), ...facetConditions(f)];
}

/** key + label KQL expressions for a Top-N dimension (mirrors clickhouse dimExpr).
 *
 * For the `country`/`city` dimensions the key is the country *name* (AFD has no
 * ISO-2); the adapter converts the name to ISO-2 on the way out so the result
 * matches the filter + world map. `city` requires {@link geoProjection}. */
export function dimExpr(d: Dimension): { key: string; label: string; needsGeo?: boolean } {
  switch (d) {
    case "country":
      return { key: "countryName", label: "countryName" };
    case "city":
      return { key: "city", label: `strcat(city, ", ", countryName)`, needsGeo: true };
    case "asnOrg":
      return { key: "asnOrg", label: "asnOrg" };
    case "clientIp":
      return { key: "clientIp", label: "clientIp" };
    case "host":
      return { key: "host", label: "host" };
    case "path":
      return { key: "hostPath", label: "hostPath" };
    case "status":
      return { key: "tostring(statusNum)", label: "tostring(statusNum)" };
    case "statusClass":
      return { key: `strcat(tostring(statusClass), "xx")`, label: `strcat(tostring(statusClass), "xx")` };
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
      return { key: `iff(isempty(referer), "(none)", referer)`, label: `iff(isempty(referer), "(direct)", referer)` };
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
  // extract_all('/([^/]+)', path) → the non-empty path segments as an array;
  // take the first `d`, rejoin with a leading '/'. If the path already has <= d
  // segments, keep it whole (mirrors clickhouse pathGroupExpr / mock).
  const segs = `extract_all(@"/([^/]+)", path)`;
  return (
    `iff(array_length(${segs}) <= ${d}, path, ` +
    `strcat("/", strcat_array(array_slice(${segs}, 0, ${d}), "/")))`
  );
}

/** Choose a sensible bucket size (seconds) for a span (mirror clickhouse autoBucketSeconds). */
export function autoBucketSeconds(spanSeconds: number, targetPoints = 150): number {
  const nice = [60, 300, 900, 1800, 3600, 10800, 21600, 43200, 86400, 604800];
  const ideal = spanSeconds / targetPoints;
  for (const b of nice) if (b >= ideal) return b;
  return nice[nice.length - 1];
}

/** Convenience: resolve time + return both the conditions and the [from,to]. */
export function whereFor(f: Filter): { conds: string[]; from: Date; to: Date } {
  const { from, to } = resolveTimeRange(f);
  return { conds: filterConditions(f, from, to), from, to };
}
