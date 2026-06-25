"use client";

import type { MetricAnomaly, MetricKey } from "@/lib/anomaly";
import { fmtBytes, fmtInt, fmtMs, fmtPct } from "@/lib/format";
import { Delta } from "@/components/ui/delta";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Pick the formatter that matches each KPI's unit. */
function fmtValue(key: MetricKey, v: number): string {
  switch (key) {
    case "bytes":
      return fmtBytes(v);
    case "cacheHitRatio":
      return fmtPct(v);
    case "errorRate4xx":
    case "errorRate5xx":
      return fmtPct(v, 2);
    case "p95LatencyMs":
    case "avgLatencyMs":
      return fmtMs(v);
    default:
      return fmtInt(v);
  }
}

/**
 * Horizontal, wrap-friendly strip of the eight KPIs. Each chip shows the value,
 * a period-over-period change indicator, and an anomaly badge when flagged. The
 * selected chip gets an accent ring/bg.
 */
export function MetricStrip({
  anomalies,
  selected,
  onSelect,
}: {
  anomalies: MetricAnomaly[];
  selected: MetricKey;
  onSelect: (key: MetricKey) => void;
}) {
  if (anomalies.length === 0) {
    return (
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-[4.75rem] min-w-[8.5rem] flex-1" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {anomalies.map((a) => {
        const isSel = a.key === selected;
        // Whether this move is in the "bad" direction for the metric.
        const isBad = a.direction !== "flat" && (a.direction === "up") !== a.goodWhenUp;
        return (
          <button
            key={a.key}
            type="button"
            onClick={() => onSelect(a.key)}
            aria-pressed={isSel}
            className={cn(
              "min-w-[8.5rem] flex-1 rounded-lg border px-3 py-2 text-left transition-colors",
              isSel
                ? "border-accent bg-accent/5 ring-1 ring-accent/40"
                : "border-line bg-surface hover:bg-panel-2",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] font-medium uppercase tracking-wide text-faint">
                {a.label}
              </span>
              {a.anomalous && (
                <Badge variant={isBad ? "danger" : "success"} className="shrink-0 gap-1">
                  <span
                    className={cn("size-1.5 rounded-full", isBad ? "bg-danger" : "bg-success")}
                  />
                  Anomaly
                </Badge>
              )}
            </div>
            <div className="mt-1 text-base font-semibold tabular text-foreground">
              {fmtValue(a.key, a.value)}
            </div>
            <div className="mt-0.5">
              <Delta value={a.delta} goodWhenUp={a.goodWhenUp} />
            </div>
          </button>
        );
      })}
    </div>
  );
}
