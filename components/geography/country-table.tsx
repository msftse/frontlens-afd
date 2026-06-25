"use client";

import type { GeoRow } from "@/lib/domain/types";
import type { GeoMetric } from "@/components/charts/world-map";
import { fmtBytes, fmtCompact, fmtInt, fmtPct, flagEmoji } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

function metricValue(r: GeoRow, m: GeoMetric): string {
  if (m === "bytes") return fmtBytes(r.bytes);
  if (m === "uniqueVisitors") return fmtCompact(r.uniqueVisitors);
  return fmtCompact(r.requests);
}

export function CountryTable({
  rows,
  loading,
  metric,
  selected,
  onSelect,
}: {
  rows: GeoRow[];
  loading: boolean;
  metric: GeoMetric;
  selected: string[];
  onSelect: (iso2: string) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-1.5 p-2">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return <div className="px-4 py-10 text-center text-xs text-faint">No traffic in range.</div>;
  }

  const max = Math.max(1, ...rows.map((r) => r[metric]));

  return (
    <div className="max-h-[460px] overflow-auto">
      {rows.map((r, i) => {
        const isSel = selected.includes(r.country);
        return (
          <button
            key={r.country}
            onClick={() => onSelect(r.country)}
            className={cn(
              "group relative flex w-full items-center gap-2.5 overflow-hidden px-3 py-1.5 text-left",
              isSel ? "bg-accent/10" : "hover:bg-panel-2/60",
            )}
          >
            <span
              className="absolute inset-y-0 left-0 bg-accent/10"
              style={{ width: `${(r[metric] / max) * 100}%` }}
            />
            <span className="relative z-10 w-5 text-right text-xs text-faint tabular">{i + 1}</span>
            <span className="relative z-10 text-base leading-none">{flagEmoji(r.country)}</span>
            <span className="relative z-10 min-w-0 flex-1 truncate text-xs text-foreground">
              {r.countryName}
            </span>
            <span className="relative z-10 hidden text-[11px] text-faint tabular sm:block">
              {fmtInt(r.uniqueVisitors)} ip
            </span>
            <span
              className={cn(
                "relative z-10 hidden text-[11px] tabular md:block",
                r.errorRate > 0.05 ? "text-danger" : "text-faint",
              )}
            >
              {fmtPct(r.errorRate, 1)}
            </span>
            <span className="relative z-10 w-14 text-right text-xs font-medium tabular text-foreground">
              {metricValue(r, metric)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
