"use client";

import { X } from "lucide-react";

import type { Filter } from "@/lib/filters/model";
import { useGeo, useSummary, useVisitors } from "@/lib/api/hooks";
import { fmtBytes, fmtCompact, fmtMs, fmtPct, flagEmoji } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface Item {
  host: string;
  path: string;
}

function scopedFilter(filter: Filter, item: Item): Filter {
  return { ...filter, path: [...filter.path, { mode: "exact", value: `${item.host}${item.path}` }] };
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-faint">{label}</span>
      <span className={cn("font-medium tabular", tone ?? "text-foreground")}>{value}</span>
    </div>
  );
}

function CompareCard({
  filter,
  item,
  onRemove,
}: {
  filter: Filter;
  item: Item;
  onRemove: () => void;
}) {
  const f = scopedFilter(filter, item);
  const summary = useSummary(f);
  const geo = useGeo(f);
  const visitors = useVisitors(f, { limit: 1 });
  const s = summary.data;
  const topCountry = geo.data?.[0];
  const topVisitor = visitors.data?.rows?.[0];

  return (
    <div className="w-60 shrink-0 rounded-xl border border-line bg-panel p-3">
      <div className="mb-2 flex items-start justify-between gap-1">
        <div className="min-w-0 font-mono text-xs">
          <div className="text-faint">{item.host}</div>
          <div className="truncate font-medium text-foreground">{item.path}</div>
        </div>
        <button onClick={onRemove} className="rounded p-0.5 text-faint hover:text-danger">
          <X className="size-3.5" />
        </button>
      </div>
      {summary.isLoading || !s ? (
        <div className="space-y-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-1.5">
          <Metric label="Requests" value={fmtCompact(s.requests)} />
          <Metric label="Unique visitors" value={fmtCompact(s.uniqueVisitors)} tone="text-accent" />
          <Metric
            label="Error rate"
            value={fmtPct(s.errorRate4xx + s.errorRate5xx, 1)}
            tone={s.errorRate4xx + s.errorRate5xx > 0.05 ? "text-danger" : "text-foreground"}
          />
          <Metric label="Cache hit" value={fmtPct(s.cacheHitRatio, 0)} />
          <Metric label="Avg latency" value={fmtMs(s.avgLatencyMs)} />
          <Metric label="Data" value={fmtBytes(s.bytes)} />
          <div className="mt-2 border-t border-line pt-2">
            <Metric
              label="Top country"
              value={topCountry ? `${flagEmoji(topCountry.country)} ${topCountry.country}` : "—"}
            />
            <div className="mt-1 flex items-center justify-between text-xs">
              <span className="text-faint">Top visitor</span>
              <span className="truncate pl-2 font-mono text-[11px] text-foreground">
                {topVisitor?.clientIp ?? "—"}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function CompareBar({
  filter,
  items,
  onRemove,
  onClear,
}: {
  filter: Filter;
  items: Item[];
  onRemove: (item: Item) => void;
  onClear: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Comparing {items.length} path{items.length > 1 ? "s" : ""}
        </h3>
        <button onClick={onClear} className="text-xs text-faint hover:text-danger">
          Clear
        </button>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {items.map((item) => (
          <CompareCard
            key={`${item.host}${item.path}`}
            filter={filter}
            item={item}
            onRemove={() => onRemove(item)}
          />
        ))}
      </div>
    </div>
  );
}
