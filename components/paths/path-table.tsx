"use client";

import { ArrowDown, ArrowUp, GitCompareArrows } from "lucide-react";

import type { PathRow } from "@/lib/domain/types";
import { fmtBytes, fmtCompact, fmtMs, fmtPct, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBar } from "@/components/charts/status-bar";

export type PathSortKey =
  | "requests"
  | "uniqueVisitors"
  | "bytes"
  | "errorRate"
  | "avgLatencyMs";

export function pathKey(r: { host: string; path: string }) {
  return `${r.host}${r.path}`;
}

function SortHeader({
  label,
  k,
  sortBy,
  sortDir,
  onSort,
  className,
}: {
  label: string;
  k: PathSortKey;
  sortBy: PathSortKey;
  sortDir: "asc" | "desc";
  onSort: (k: PathSortKey) => void;
  className?: string;
}) {
  const active = sortBy === k;
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide transition-colors",
        active ? "text-foreground" : "text-faint hover:text-muted",
        className,
      )}
    >
      {label}
      {active &&
        (sortDir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
    </button>
  );
}

export function PathTable({
  rows,
  loading,
  selectedKey,
  onSelect,
  compareKeys,
  onToggleCompare,
  sortBy,
  sortDir,
  onSort,
}: {
  rows: PathRow[];
  loading: boolean;
  selectedKey: string | null;
  onSelect: (row: PathRow) => void;
  compareKeys: string[];
  onToggleCompare: (row: PathRow) => void;
  sortBy: PathSortKey;
  sortDir: "asc" | "desc";
  onSort: (k: PathSortKey) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-surface text-left">
            <th className="w-8 px-2 py-2.5" />
            <th className="px-3 py-2.5 text-[11px] font-medium uppercase tracking-wide text-faint">
              Path
            </th>
            <th className="px-3 py-2.5">
              <SortHeader label="Requests" k="requests" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            </th>
            <th className="px-3 py-2.5">
              <SortHeader label="Visitors" k="uniqueVisitors" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            </th>
            <th className="hidden px-3 py-2.5 lg:table-cell">
              <span className="text-[11px] font-medium uppercase tracking-wide text-faint">Status mix</span>
            </th>
            <th className="px-3 py-2.5">
              <SortHeader label="Errors" k="errorRate" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            </th>
            <th className="hidden px-3 py-2.5 md:table-cell">
              <SortHeader label="Data" k="bytes" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            </th>
            <th className="px-3 py-2.5">
              <SortHeader label="Latency" k="avgLatencyMs" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            </th>
            <th className="hidden px-3 py-2.5 text-right xl:table-cell">
              <span className="text-[11px] font-medium uppercase tracking-wide text-faint">Last seen</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: 10 }).map((_, i) => (
              <tr key={i} className="border-b border-line/60">
                <td colSpan={9} className="px-3 py-2">
                  <Skeleton className="h-6 w-full" />
                </td>
              </tr>
            ))}

          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={9} className="px-3 py-10 text-center text-xs text-faint">
                No paths match the current filters.
              </td>
            </tr>
          )}

          {!loading &&
            rows.map((r) => {
              const key = pathKey(r);
              const selected = selectedKey === key;
              const comparing = compareKeys.includes(key);
              return (
                <tr
                  key={key}
                  onClick={() => onSelect(r)}
                  className={cn(
                    "cursor-pointer border-b border-line/60 transition-colors",
                    selected ? "bg-accent/10" : "hover:bg-panel-2/50",
                  )}
                >
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleCompare(r);
                      }}
                      title="Add to compare"
                      className={cn(
                        "flex size-5 items-center justify-center rounded-md border transition-colors",
                        comparing
                          ? "border-accent bg-accent/20 text-accent"
                          : "border-line text-faint hover:text-foreground",
                      )}
                    >
                      <GitCompareArrows className="size-3" />
                    </button>
                  </td>
                  <td className="max-w-[280px] px-3 py-2">
                    <div className="truncate font-mono text-xs">
                      <span className="text-faint">{r.host}</span>
                      <span className="text-foreground">{r.path}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium tabular text-foreground">{fmtCompact(r.requests)}</div>
                    <div className="mt-1 h-1 w-16 overflow-hidden rounded-full bg-line">
                      <span
                        className="block h-full bg-accent/50"
                        style={{ width: `${Math.max(2, r.share * 100).toFixed(1)}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2 tabular text-foreground">{fmtCompact(r.uniqueVisitors)}</td>
                  <td className="hidden px-3 py-2 lg:table-cell">
                    <StatusBar
                      className="w-28"
                      s2={r.status2xx}
                      s3={r.status3xx}
                      s4={r.status4xx}
                      s5={r.status5xx}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "tabular",
                        r.errorRate > 0.05
                          ? "text-danger"
                          : r.errorRate > 0.01
                            ? "text-warning"
                            : "text-muted",
                      )}
                    >
                      {fmtPct(r.errorRate, 1)}
                    </span>
                  </td>
                  <td className="hidden px-3 py-2 tabular text-muted md:table-cell">{fmtBytes(r.bytes)}</td>
                  <td className="px-3 py-2 tabular text-muted">{fmtMs(r.avgLatencyMs)}</td>
                  <td className="hidden px-3 py-2 text-right text-xs text-faint xl:table-cell">
                    {fmtRelative(r.lastSeen)}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
