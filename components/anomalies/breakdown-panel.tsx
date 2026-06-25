"use client";

import { Filter as FilterIcon, Minus, ScrollText, Users } from "lucide-react";

import type { Dimension } from "@/lib/domain/types";
import type { PathExplorerOptions } from "@/lib/datasource/types";
import { decodeStatus, type Filter, type StatusFilter } from "@/lib/filters/model";
import type { BreakdownDim, MetricKey } from "@/lib/anomaly";
import { usePaths, useTopN } from "@/lib/api/hooks";
import { fmtBytes, fmtCompact, fmtMs } from "@/lib/format";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Pure filter-scope helpers (shared with the page). `mergeFilter` scopes the
// breakdown queries with a transient prefilter; it is NEVER serialized to the
// URL — only an explicit row action (Filter / Exclude / Open in …) mutates state.
// ---------------------------------------------------------------------------

/** Filter facets that are plain `string[]` and share a key name with a Dimension. */
const STRING_FACET_DIMS = [
  "host",
  "country",
  "city",
  "asnOrg",
  "clientIp",
  "method",
  "uaFamily",
  "pop",
  "cacheStatus",
  "ja4",
  "referer",
] as const;
type StringFacetDim = (typeof STRING_FACET_DIMS)[number];

const DEVICE_TYPES = ["desktop", "mobile", "tablet", "bot"] as const;
type DeviceTypeLit = (typeof DEVICE_TYPES)[number];

const uniq = <T,>(xs: T[]): T[] => Array.from(new Set(xs));

function isStringFacetDim(d: Dimension): d is StringFacetDim {
  return (STRING_FACET_DIMS as readonly string[]).includes(d);
}
function isDeviceType(s: string): s is DeviceTypeLit {
  return (DEVICE_TYPES as readonly string[]).includes(s);
}

/**
 * Concatenate a transient `prefilter` (e.g. `status:5xx`, `cacheStatus:MISS`)
 * onto the live filter for breakdown queries only. Pure — returns a new Filter,
 * mutates nothing, and is never written back to the URL.
 */
export function mergeFilter(base: Filter, patch?: Partial<Filter>): Filter {
  if (!patch) return base;
  const out: Filter = { ...base };
  for (const dim of STRING_FACET_DIMS) {
    const add = patch[dim];
    if (add && add.length) out[dim] = uniq([...(base[dim] as string[]), ...add]);
  }
  if (patch.cidr?.length) out.cidr = uniq([...base.cidr, ...patch.cidr]);
  if (patch.deviceType?.length) out.deviceType = uniq([...base.deviceType, ...patch.deviceType]);
  if (patch.path?.length) out.path = [...base.path, ...patch.path];
  if (patch.status?.length) out.status = uniq<StatusFilter>([...base.status, ...patch.status]);
  if (patch.q) out.q = patch.q;
  if (patch.not) out.not = { ...(base.not ?? {}), ...patch.not };
  return out;
}

/** Pin a single `dimension = value` constraint onto a filter (for "Open in …"). Pure. */
export function pinFilterValue(base: Filter, dim: Dimension, key: string): Filter {
  if (dim === "path") return { ...base, path: [...base.path, { mode: "exact", value: key }] };
  if (dim === "status") {
    const s = decodeStatus(key);
    return s === null ? base : { ...base, status: uniq<StatusFilter>([...base.status, s]) };
  }
  if (dim === "deviceType") {
    if (!isDeviceType(key)) return base;
    return { ...base, deviceType: uniq([...base.deviceType, key]) };
  }
  if (isStringFacetDim(dim)) {
    const out: Filter = { ...base };
    out[dim] = uniq([...(base[dim] as string[]), key]);
    return out;
  }
  return base; // errorInfo / statusClass have no Filter field — leave scope unchanged.
}

// ---------------------------------------------------------------------------
// Row actions (wired by the page; the panel stays presentational).
// ---------------------------------------------------------------------------

export interface BreakdownActions {
  filter: (dim: Dimension, key: string) => void;
  exclude: (dim: Dimension, key: string) => void;
  openInLogs: (dim: Dimension, key: string) => void;
  openInVisitors?: (dim: Dimension, key: string) => void;
}

interface BreakdownPanelProps {
  metric: MetricKey;
  dim: BreakdownDim;
  filter: Filter;
  prefilter?: Partial<Filter>;
  on: BreakdownActions;
}

/** Dimensions that map to a Filter field (so Filter/Exclude make sense). */
const FILTERABLE_DIMS = new Set<Dimension>([...STRING_FACET_DIMS, "path", "status", "deviceType"]);
const VISITOR_DIMS = new Set<Dimension>(["clientIp", "country", "asnOrg"]);

function isLatencyMetric(m: MetricKey): boolean {
  return m === "p95LatencyMs" || m === "avgLatencyMs";
}

/** The contribution to surface per row, chosen to match the metric under analysis. */
function rowValue(
  metric: MetricKey,
  requests: number,
  uniqueVisitors: number,
  bytes: number,
  avgLatencyMs?: number,
): string {
  switch (metric) {
    case "bytes":
      return fmtBytes(bytes);
    case "uniqueVisitors":
      return fmtCompact(uniqueVisitors);
    case "p95LatencyMs":
    case "avgLatencyMs":
      return avgLatencyMs !== undefined ? fmtMs(avgLatencyMs) : fmtCompact(requests);
    default:
      return fmtCompact(requests);
  }
}

function barClass(metric: MetricKey): string {
  switch (metric) {
    case "errorRate5xx":
      return "bg-danger/20";
    case "errorRate4xx":
    case "p95LatencyMs":
    case "avgLatencyMs":
      return "bg-warning/20";
    case "cacheHitRatio":
      return "bg-info/20";
    default:
      return "bg-accent/20";
  }
}

interface Row {
  key: string;
  actionKey: string;
  label: string;
  value: string;
  share: number;
}

/**
 * One "what's driving it" breakdown card. Branches on the dimension so each
 * concrete child calls exactly one data hook (Rules of Hooks + no double fetch).
 */
export function BreakdownPanel({ metric, dim, filter, prefilter, on }: BreakdownPanelProps) {
  const scoped = mergeFilter(filter, prefilter);
  if (dim.dimension === "path") {
    return <PathBreakdown metric={metric} dim={dim} scoped={scoped} on={on} />;
  }
  return <TopNBreakdown metric={metric} dim={dim} scoped={scoped} on={on} />;
}

function PathBreakdown({
  metric,
  dim,
  scoped,
  on,
}: {
  metric: MetricKey;
  dim: BreakdownDim;
  scoped: Filter;
  on: BreakdownActions;
}) {
  // Path Explorer can sort by latency; Top-N can't. Honor the configured sort
  // otherwise (e.g. "bytes" for the data-transferred breakdown).
  const sortBy: NonNullable<PathExplorerOptions["sortBy"]> = isLatencyMetric(metric)
    ? "avgLatencyMs"
    : (dim.sortBy ?? "requests");
  const q = usePaths(scoped, { sortBy, limit: 8 });
  const rows: Row[] = (q.data?.rows ?? []).map((r) => ({
    key: `${r.host}${r.path}`,
    actionKey: r.path,
    label: r.path,
    value: rowValue(metric, r.requests, r.uniqueVisitors, r.bytes, r.avgLatencyMs),
    share: r.share,
  }));
  return (
    <BreakdownCard title={dim.label} dim="path" metric={metric} rows={rows} loading={q.isLoading} on={on} />
  );
}

function TopNBreakdown({
  metric,
  dim,
  scoped,
  on,
}: {
  metric: MetricKey;
  dim: BreakdownDim;
  scoped: Filter;
  on: BreakdownActions;
}) {
  const q = useTopN(scoped, { dimension: dim.dimension, sortBy: dim.sortBy, limit: 8 });
  const rows: Row[] = (q.data ?? []).map((r) => ({
    key: r.key,
    actionKey: r.key,
    label: r.label,
    value: rowValue(metric, r.requests, r.uniqueVisitors, r.bytes),
    share: r.share,
  }));
  return (
    <BreakdownCard
      title={dim.label}
      dim={dim.dimension}
      metric={metric}
      rows={rows}
      loading={q.isLoading}
      on={on}
    />
  );
}

function BreakdownCard({
  title,
  dim,
  metric,
  rows,
  loading,
  on,
}: {
  title: string;
  dim: Dimension;
  metric: MetricKey;
  rows: Row[];
  loading: boolean;
  on: BreakdownActions;
}) {
  const canFacet = FILTERABLE_DIMS.has(dim);
  const showVisitors = VISITOR_DIMS.has(dim) && !!on.openInVisitors;
  const bar = barClass(metric);

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-1">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <div className="px-1.5 pb-2 pt-1">
        {loading ? (
          <div className="space-y-1.5 px-0.5 py-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-faint">No data</div>
        ) : (
          rows.map((r) => (
            <div
              key={r.key}
              className="group relative flex items-center gap-2 overflow-hidden rounded-md px-2 py-1.5"
            >
              <span
                className={cn("absolute inset-y-0 left-0 rounded-md", bar)}
                style={{ width: `${Math.max(2, r.share * 100).toFixed(1)}%` }}
              />
              <span className="relative z-10 min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                {r.label}
              </span>
              <span className="relative z-10 shrink-0 text-xs font-medium tabular text-foreground">
                {r.value}
              </span>
              <span className="absolute right-1 z-20 flex items-center gap-0.5 rounded-md bg-surface px-1 py-0.5 opacity-0 shadow-sm ring-1 ring-line transition-opacity group-hover:opacity-100">
                {canFacet && (
                  <RowAction title="Filter to this" onClick={() => on.filter(dim, r.actionKey)}>
                    <FilterIcon className="size-3" />
                  </RowAction>
                )}
                {canFacet && (
                  <RowAction title="Exclude this" onClick={() => on.exclude(dim, r.actionKey)}>
                    <Minus className="size-3" />
                  </RowAction>
                )}
                {showVisitors && (
                  <RowAction
                    title="Open in Visitors"
                    onClick={() => on.openInVisitors?.(dim, r.actionKey)}
                  >
                    <Users className="size-3" />
                  </RowAction>
                )}
                <RowAction title="Open in Logs" onClick={() => on.openInLogs(dim, r.actionKey)}>
                  <ScrollText className="size-3" />
                </RowAction>
              </span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function RowAction({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="rounded p-1 text-faint transition-colors hover:bg-panel-2 hover:text-accent"
    >
      {children}
    </button>
  );
}
