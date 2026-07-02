"use client";

import { useCallback, useMemo } from "react";
import {
  createParser,
  parseAsArrayOf,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs";

import {
  TIME_PRESETS,
  clampRange,
  decodePathPattern,
  decodeStatus,
  emptyFilter,
  encodePathPattern,
  encodeStatus,
  filterSchema,
  type Filter,
  type PathPattern,
  type StatusFilter,
  type TimePreset,
} from "@/lib/filters/model";

const pathItem = createParser<PathPattern>({
  parse: (v) => decodePathPattern(v),
  serialize: (p) => encodePathPattern(p),
});

const statusItem = createParser<StatusFilter>({
  parse: (v) => decodeStatus(v),
  serialize: (s) => encodeStatus(s),
});

const timePresets = Object.keys(TIME_PRESETS) as [TimePreset, ...TimePreset[]];
const deviceTypes = ["desktop", "mobile", "tablet", "bot"] as const;

const strList = () => parseAsArrayOf(parseAsString).withDefault([]);

const parsers = {
  range: parseAsStringLiteral(timePresets).withDefault("24h"),
  from: parseAsString,
  to: parseAsString,
  host: strList(),
  path: parseAsArrayOf(pathItem).withDefault([]),
  country: strList(),
  city: strList(),
  asnOrg: strList(),
  clientIp: strList(),
  cidr: strList(),
  status: parseAsArrayOf(statusItem).withDefault([]),
  method: strList(),
  uaFamily: strList(),
  deviceType: parseAsArrayOf(parseAsStringLiteral(deviceTypes)).withDefault([]),
  pop: strList(),
  cacheStatus: strList(),
  ja4: strList(),
  referer: strList(),
  n_host: strList(),
  n_country: strList(),
  n_city: strList(),
  n_asnOrg: strList(),
  n_clientIp: strList(),
  n_method: strList(),
  n_uaFamily: strList(),
  n_deviceType: strList(),
  n_pop: strList(),
  n_cacheStatus: strList(),
  n_ja4: strList(),
  n_referer: strList(),
  n_status: parseAsArrayOf(statusItem).withDefault([]),
  q: parseAsString,
};

const queryOptions = { history: "replace", shallow: true, throttleMs: 120 } as const;

/** Array-valued facet keys that support toggle/clear. */
export type FacetKey =
  | "host"
  | "country"
  | "city"
  | "asnOrg"
  | "clientIp"
  | "cidr"
  | "method"
  | "uaFamily"
  | "pop"
  | "cacheStatus"
  | "ja4"
  | "referer";

/** Facet keys that support the Cloudflare-style "Exclude" (negation). */
export type ExcludeKey =
  | "host"
  | "country"
  | "city"
  | "asnOrg"
  | "clientIp"
  | "method"
  | "uaFamily"
  | "deviceType"
  | "pop"
  | "cacheStatus"
  | "ja4"
  | "referer";

const NOT_KEYS: readonly ExcludeKey[] = [
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
];

/**
 * The single source of truth for filter state. Reads/writes the URL (shallow,
 * shareable) and hands a normalized `Filter` to the rest of the app.
 */
export function useFilters() {
  const [raw, setRaw] = useQueryStates(parsers, queryOptions);

  const filter: Filter = useMemo(() => {
    const not: Record<string, unknown> = {};
    for (const key of NOT_KEYS) {
      const arr = raw[`n_${key}` as keyof typeof raw] as string[];
      if (arr && arr.length) not[key] = arr;
    }
    if (raw.n_status.length) not.status = raw.n_status;

    const parsed = filterSchema.safeParse({
      range: raw.range,
      from: raw.from ?? undefined,
      to: raw.to ?? undefined,
      host: raw.host,
      path: raw.path,
      country: raw.country,
      city: raw.city,
      asnOrg: raw.asnOrg,
      clientIp: raw.clientIp,
      cidr: raw.cidr,
      status: raw.status,
      method: raw.method,
      uaFamily: raw.uaFamily,
      deviceType: raw.deviceType,
      pop: raw.pop,
      cacheStatus: raw.cacheStatus,
      ja4: raw.ja4,
      referer: raw.referer,
      not: Object.keys(not).length ? not : undefined,
      q: raw.q ?? undefined,
    });
    return parsed.success ? parsed.data : emptyFilter();
  }, [raw]);

  const setRange = useCallback(
    (range: TimePreset) => setRaw({ range, from: null, to: null }),
    [setRaw],
  );

  const setCustomRange = useCallback(
    (from: string, to: string) => {
      const r = clampRange(from, to);
      setRaw({ from: r.from, to: r.to });
    },
    [setRaw],
  );

  const toggle = useCallback(
    (key: FacetKey, value: string) => {
      setRaw((prev) => {
        const cur = (prev[key] as string[]) ?? [];
        const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
        return { [key]: next.length ? next : [] };
      });
    },
    [setRaw],
  );

  const setFacet = useCallback(
    (key: FacetKey, values: string[]) => setRaw({ [key]: values }),
    [setRaw],
  );

  const setSearch = useCallback((q: string) => setRaw({ q: q || null }), [setRaw]);

  const addPath = useCallback(
    (p: PathPattern) =>
      setRaw((prev) => {
        const exists = prev.path.some(
          (x) => x.mode === p.mode && x.value === p.value && !!x.negate === !!p.negate,
        );
        return exists ? {} : { path: [...prev.path, p] };
      }),
    [setRaw],
  );

  const removePath = useCallback(
    (index: number) => setRaw((prev) => ({ path: prev.path.filter((_, i) => i !== index) })),
    [setRaw],
  );

  const toggleStatus = useCallback(
    (s: StatusFilter) =>
      setRaw((prev) => {
        const exists = prev.status.some((x) => x === s);
        return { status: exists ? prev.status.filter((x) => x !== s) : [...prev.status, s] };
      }),
    [setRaw],
  );

  const setNot = useCallback(
    (key: ExcludeKey, fn: (cur: string[]) => string[]) =>
      setRaw((prev) => {
        const k = `n_${key}` as keyof typeof prev;
        const cur = (prev[k] as string[]) ?? [];
        return { [k]: fn(cur) } as Partial<typeof prev>;
      }),
    [setRaw],
  );

  const exclude = useCallback(
    (key: ExcludeKey, value: string) =>
      setNot(key, (cur) => (cur.includes(value) ? cur : [...cur, value])),
    [setNot],
  );

  const toggleExclude = useCallback(
    (key: ExcludeKey, value: string) =>
      setNot(key, (cur) =>
        cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value],
      ),
    [setNot],
  );

  const toggleExcludeStatus = useCallback(
    (value: StatusFilter) =>
      setRaw((prev) => {
        const cur = prev.n_status ?? [];
        const exists = cur.some((x) => x === value);
        return { n_status: exists ? cur.filter((x) => x !== value) : [...cur, value] };
      }),
    [setRaw],
  );

  const clearAll = useCallback(() => {
    setRaw({
      host: [],
      path: [],
      country: [],
      city: [],
      asnOrg: [],
      clientIp: [],
      cidr: [],
      status: [],
      method: [],
      uaFamily: [],
      deviceType: [],
      pop: [],
      cacheStatus: [],
      ja4: [],
      referer: [],
      n_host: [],
      n_country: [],
      n_city: [],
      n_asnOrg: [],
      n_clientIp: [],
      n_method: [],
      n_uaFamily: [],
      n_deviceType: [],
      n_pop: [],
      n_cacheStatus: [],
      n_ja4: [],
      n_referer: [],
      n_status: [],
      q: null,
    });
  }, [setRaw]);

  return {
    filter,
    raw,
    setRaw,
    setRange,
    setCustomRange,
    toggle,
    setFacet,
    setSearch,
    addPath,
    removePath,
    toggleStatus,
    exclude,
    toggleExclude,
    toggleExcludeStatus,
    clearAll,
  };
}

export type UseFiltersReturn = ReturnType<typeof useFilters>;
