import { z } from "zod";

/**
 * The canonical filter model. ONE schema, shared by the UI, the BFF route
 * handlers, and every data-source adapter (mock now; ClickHouse/Log Analytics
 * later, where it compiles to SQL / KQL).
 *
 * It also (de)serializes to URLSearchParams so the entire filter state lives in
 * the URL → every view is a shareable, bookmarkable link.
 */

export const TIME_PRESETS = {
  "1h": { label: "Last hour", ms: 60 * 60 * 1000 },
  "24h": { label: "Last 24 hours", ms: 24 * 60 * 60 * 1000 },
  "7d": { label: "Last 7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  "30d": { label: "Last 30 days", ms: 30 * 24 * 60 * 60 * 1000 },
  "90d": { label: "Last 90 days", ms: 90 * 24 * 60 * 60 * 1000 },
} as const;

export type TimePreset = keyof typeof TIME_PRESETS;

export const PATH_MATCH_MODES = ["exact", "prefix", "glob", "regex"] as const;
export type PathMatchMode = (typeof PATH_MATCH_MODES)[number];

export const pathPatternSchema = z.object({
  mode: z.enum(PATH_MATCH_MODES).default("prefix"),
  value: z.string().min(1),
  negate: z.boolean().optional(),
});
export type PathPattern = z.infer<typeof pathPatternSchema>;

export const statusFilterSchema = z.union([
  z.literal("2xx"),
  z.literal("3xx"),
  z.literal("4xx"),
  z.literal("5xx"),
  z.number().int(),
]);
export type StatusFilter = z.infer<typeof statusFilterSchema>;

/**
 * Negated facets - the Cloudflare-style "Exclude". A record matches the filter
 * only if it does NOT match any of these. Same value types as the positive
 * facets (deviceType kept as plain strings here - it's only an exclusion test).
 * Serialized to the URL as `n_<key>` params.
 */
export const notFilterSchema = z.object({
  host: z.array(z.string()).optional(),
  country: z.array(z.string()).optional(),
  city: z.array(z.string()).optional(),
  asnOrg: z.array(z.string()).optional(),
  clientIp: z.array(z.string()).optional(),
  method: z.array(z.string()).optional(),
  uaFamily: z.array(z.string()).optional(),
  deviceType: z.array(z.string()).optional(),
  pop: z.array(z.string()).optional(),
  cacheStatus: z.array(z.string()).optional(),
  ja4: z.array(z.string()).optional(),
  referer: z.array(z.string()).optional(),
  status: z.array(statusFilterSchema).optional(),
});
export type NotFilter = z.infer<typeof notFilterSchema>;

export const filterSchema = z.object({
  // Time window: a relative preset (default) or an explicit custom range.
  range: z.enum(Object.keys(TIME_PRESETS) as [TimePreset, ...TimePreset[]]).default("24h"),
  from: z.string().optional(),
  to: z.string().optional(),

  // Host / domain
  host: z.array(z.string()).default([]),

  // Path patterns - the headline capability (e.g. nadav.com/api, /api/*, regex)
  path: z.array(pathPatternSchema).default([]),

  // Geography (derived via enrichment)
  country: z.array(z.string()).default([]),
  city: z.array(z.string()).default([]),
  asnOrg: z.array(z.string()).default([]),

  // The "who"
  clientIp: z.array(z.string()).default([]),
  cidr: z.array(z.string()).default([]),

  // Response / request
  status: z.array(statusFilterSchema).default([]),
  method: z.array(z.string()).default([]),

  // Client fingerprint / edge
  uaFamily: z.array(z.string()).default([]),
  deviceType: z.array(z.enum(["desktop", "mobile", "tablet", "bot"])).default([]),
  pop: z.array(z.string()).default([]),
  cacheStatus: z.array(z.string()).default([]),
  ja4: z.array(z.string()).default([]),
  referer: z.array(z.string()).default([]),

  // Negated facets (Cloudflare-style "Exclude"). Present only when something is excluded.
  not: notFilterSchema.optional(),

  // Free-text search across url/ua/ip/referer
  q: z.string().optional(),
});

export type Filter = z.infer<typeof filterSchema>;

export function emptyFilter(): Filter {
  return filterSchema.parse({});
}

/** Resolve the filter's time window to concrete [from, to] Date objects. */
export function resolveTimeRange(f: Filter, now = new Date()): { from: Date; to: Date } {
  if (f.from && f.to) {
    return { from: new Date(f.from), to: new Date(f.to) };
  }
  const span = TIME_PRESETS[f.range]?.ms ?? TIME_PRESETS["24h"].ms;
  return { from: new Date(now.getTime() - span), to: now };
}

/**
 * Smallest custom range we allow (60s = the smallest auto timeseries bucket, so
 * a clamped window always spans at least one bucket).
 */
export const MIN_RANGE_MS = 60_000;

/**
 * Guard a custom [from, to] window so it always has real width. A zero-width or
 * inverted range (e.g. "zoom to spike" on a single-bucket outlier, where the
 * bucket-start timestamp is both endpoints) would otherwise match no rows and
 * render an empty view. Expands `to` to `from + minMs` in that case. Unparseable
 * inputs pass through untouched so callers/validators can handle them.
 */
export function clampRange(
  from: string,
  to: string,
  minMs: number = MIN_RANGE_MS,
): { from: string; to: string } {
  const f = Date.parse(from);
  const t = Date.parse(to);
  if (Number.isNaN(f) || Number.isNaN(t)) return { from, to };
  if (t - f >= minMs) return { from, to };
  return { from: new Date(f).toISOString(), to: new Date(f + minMs).toISOString() };
}

// ----------------------------------------------------------------------------
// URL (de)serialization - compact, human-readable query strings.
// Path patterns encode as `mode:value` (optionally `!mode:value` for negate).
// ----------------------------------------------------------------------------

const ARRAY_KEYS = [
  "host",
  "country",
  "city",
  "asnOrg",
  "clientIp",
  "cidr",
  "method",
  "uaFamily",
  "deviceType",
  "pop",
  "cacheStatus",
  "ja4",
  "referer",
] as const;

/** Facet keys that support negation ("Exclude"). Mirror of the string ARRAY_KEYS. */
const NOT_STRING_KEYS = [
  "host",
  "country",
  "city",
  "asnOrg",
  "clientIp",
  "method",
  "uaFamily",
  "deviceType",
  "pop",
  "cacheStatus",
  "ja4",
  "referer",
] as const;

function encodePath(p: PathPattern): string {
  return `${p.negate ? "!" : ""}${p.mode}:${p.value}`;
}

function decodePath(s: string): PathPattern | null {
  let negate = false;
  let rest = s;
  if (rest.startsWith("!")) {
    negate = true;
    rest = rest.slice(1);
  }
  const idx = rest.indexOf(":");
  if (idx === -1) {
    // Bare value → default prefix match.
    return { mode: "prefix", value: rest, negate };
  }
  const mode = rest.slice(0, idx);
  const value = rest.slice(idx + 1);
  if (!(PATH_MATCH_MODES as readonly string[]).includes(mode)) {
    return { mode: "prefix", value: rest, negate };
  }
  return { mode: mode as PathMatchMode, value, negate };
}

/** Public aliases for URL/param encoders (used by the nuqs-backed hook). */
export const encodePathPattern = encodePath;
export const decodePathPattern = decodePath;

export function encodeStatus(s: StatusFilter): string {
  return String(s);
}
export function decodeStatus(s: string): StatusFilter | null {
  if (s === "2xx" || s === "3xx" || s === "4xx" || s === "5xx") return s;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function filterToSearchParams(f: Filter): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.range !== "24h") sp.set("range", f.range);
  if (f.from) sp.set("from", f.from);
  if (f.to) sp.set("to", f.to);
  for (const key of ARRAY_KEYS) {
    const arr = f[key] as string[];
    if (arr && arr.length) sp.set(key, arr.join(","));
  }
  if (f.path.length) sp.set("path", f.path.map(encodePath).join(","));
  if (f.status.length) sp.set("status", f.status.map(String).join(","));
  if (f.not) {
    for (const key of NOT_STRING_KEYS) {
      const arr = f.not[key];
      if (arr && arr.length) sp.set(`n_${key}`, arr.join(","));
    }
    if (f.not.status && f.not.status.length) {
      sp.set("n_status", f.not.status.map(String).join(","));
    }
  }
  if (f.q) sp.set("q", f.q);
  return sp;
}

export function filterFromSearchParams(sp: URLSearchParams | Record<string, string>): Filter {
  const get = (k: string): string | undefined => {
    if (sp instanceof URLSearchParams) return sp.get(k) ?? undefined;
    return sp[k];
  };
  const splitList = (k: string): string[] => {
    const v = get(k);
    return v ? v.split(",").filter(Boolean) : [];
  };

  const raw: Record<string, unknown> = {
    range: get("range") ?? "24h",
    from: get("from"),
    to: get("to"),
    q: get("q"),
  };
  for (const key of ARRAY_KEYS) raw[key] = splitList(key);

  raw.path = splitList("path")
    .map(decodePath)
    .filter((p): p is PathPattern => p !== null);

  raw.status = splitList("status").map((s) => {
    if (s === "2xx" || s === "3xx" || s === "4xx" || s === "5xx") return s;
    const n = Number(s);
    return Number.isFinite(n) ? n : s;
  });

  const not: Record<string, unknown> = {};
  for (const key of NOT_STRING_KEYS) {
    const v = get(`n_${key}`);
    if (v) not[key] = v.split(",").filter(Boolean);
  }
  const nStatus = get("n_status");
  if (nStatus) {
    not.status = nStatus
      .split(",")
      .filter(Boolean)
      .map((s) => {
        if (s === "2xx" || s === "3xx" || s === "4xx" || s === "5xx") return s;
        const n = Number(s);
        return Number.isFinite(n) ? n : s;
      });
  }
  if (Object.keys(not).length) raw.not = not;

  const parsed = filterSchema.safeParse(raw);
  return parsed.success ? parsed.data : emptyFilter();
}

/** Count active (non-time) filter facets - for the UI "N filters" badge. */
export function countActiveFacets(f: Filter): number {
  let n = 0;
  for (const key of ARRAY_KEYS) n += (f[key] as string[]).length;
  n += f.path.length + f.status.length;
  if (f.not) {
    for (const key of NOT_STRING_KEYS) n += f.not[key]?.length ?? 0;
    n += f.not.status?.length ?? 0;
  }
  if (f.q) n += 1;
  return n;
}
