"use client";

import { ArrowUpRight } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface TopItem {
  key: string;
  label: React.ReactNode;
  value: string;
  sub?: string;
  share: number; // 0..1 for the bar
  tone?: "accent" | "success" | "warning" | "danger" | "info";
}

const toneBar: Record<NonNullable<TopItem["tone"]>, string> = {
  accent: "bg-accent/25",
  success: "bg-success/20",
  warning: "bg-warning/20",
  danger: "bg-danger/20",
  info: "bg-info/20",
};

export function TopList({
  items,
  loading,
  rows = 8,
  onSelect,
  emptyLabel = "No data",
}: {
  items: TopItem[];
  loading: boolean;
  rows?: number;
  onSelect?: (key: string) => void;
  emptyLabel?: string;
}) {
  if (loading) {
    return (
      <div className="space-y-1.5 px-2 py-1.5">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
    );
  }
  if (items.length === 0) {
    return <div className="px-4 py-8 text-center text-xs text-faint">{emptyLabel}</div>;
  }

  return (
    <div className="px-1.5 py-1.5">
      {items.slice(0, rows).map((it) => {
        const Comp = onSelect ? "button" : "div";
        return (
          <Comp
            key={it.key}
            onClick={onSelect ? () => onSelect(it.key) : undefined}
            className={cn(
              "group relative flex w-full items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-left",
              onSelect && "cursor-pointer hover:bg-panel-2",
            )}
          >
            <span
              className={cn(
                "absolute inset-y-0 left-0 rounded-md",
                toneBar[it.tone ?? "accent"],
              )}
              style={{ width: `${Math.max(2, it.share * 100).toFixed(1)}%` }}
            />
            <span className="relative z-10 min-w-0 flex-1 truncate text-xs text-foreground">
              {it.label}
            </span>
            {it.sub && (
              <span className="relative z-10 shrink-0 text-[11px] text-faint tabular">{it.sub}</span>
            )}
            <span className="relative z-10 shrink-0 text-xs font-medium tabular text-foreground">
              {it.value}
            </span>
            {onSelect && (
              <ArrowUpRight className="relative z-10 size-3 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
            )}
          </Comp>
        );
      })}
    </div>
  );
}
