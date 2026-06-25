"use client";

import { useRouter } from "next/navigation";

import type { VisitorRow } from "@/lib/domain/types";
import { fmtBytes, fmtCompact, fmtPct, fmtRelative, flagEmoji } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { DeviceIcon } from "@/components/visitors/device-icon";

export function VisitorList({
  rows,
  loading,
  compact,
  onPick,
  emptyLabel = "No visitors match.",
}: {
  rows: VisitorRow[];
  loading: boolean;
  compact?: boolean;
  /** Override navigation; default goes to the visitor drill-down page. */
  onPick?: (ip: string) => void;
  emptyLabel?: string;
}) {
  const router = useRouter();
  const go = (ip: string) =>
    onPick ? onPick(ip) : router.push(`/visitors/${encodeURIComponent(ip)}`);

  if (loading) {
    return (
      <div className="space-y-1.5 p-2">
        {Array.from({ length: compact ? 6 : 12 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return <div className="px-4 py-10 text-center text-xs text-faint">{emptyLabel}</div>;
  }

  return (
    <div className="divide-y divide-line/60">
      {rows.map((v) => (
        <button
          key={v.clientIp}
          onClick={() => go(v.clientIp)}
          className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-panel-2/60"
        >
          <span className="text-base leading-none" title={v.countryName}>
            {flagEmoji(v.country)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-foreground">{v.clientIp}</span>
              <DeviceIcon type={v.deviceType} className="size-3 text-faint" />
              {!compact && <span className="text-[11px] text-faint">{v.uaFamily}</span>}
            </div>
            <div className="truncate text-[11px] text-faint">
              {v.city ? `${v.city} · ` : ""}
              {v.asnOrg}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-xs font-medium tabular text-foreground">
              {fmtCompact(v.requests)}
              <span className="ml-1 font-normal text-faint">req</span>
            </div>
            <div className="text-[11px] text-faint tabular">
              {v.distinctPaths} paths
              {!compact && ` · ${fmtBytes(v.bytes)}`}
            </div>
          </div>
          {!compact && (
            <div className="hidden w-16 shrink-0 text-right sm:block">
              <div
                className={cn(
                  "text-xs tabular",
                  v.errorRate > 0.1 ? "text-danger" : v.errorRate > 0.02 ? "text-warning" : "text-muted",
                )}
              >
                {fmtPct(v.errorRate, 1)}
              </div>
              <div className="text-[11px] text-faint">{fmtRelative(v.lastSeen)}</div>
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
