"use client";

import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { AccessLogRecord } from "@/lib/domain/types";
import { fmtBytes, fmtDateTime, fmtMs, flagEmoji } from "@/lib/format";
import { Badge, statusVariant } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const COLS = "grid-cols-[152px_52px_54px_minmax(0,1fr)_40px_128px_48px_86px_70px_72px]";

function HeaderCell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("px-2 py-2 text-[11px] font-medium uppercase tracking-wide text-faint", className)}>
      {children}
    </div>
  );
}

export function LogTable({
  rows,
  loading,
  selectedRef,
  onRowClick,
  hasNextPage,
  fetchNextPage,
  isFetchingNextPage,
}: {
  rows: AccessLogRecord[];
  loading: boolean;
  selectedRef: string | null;
  onRowClick: (r: AccessLogRecord) => void;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  isFetchingNextPage: boolean;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 33,
    overscan: 16,
  });

  const items = virt.getVirtualItems();
  const last = items[items.length - 1];

  useEffect(() => {
    if (!last) return;
    if (last.index >= rows.length - 12 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [last, rows.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div
      ref={parentRef}
      className="h-[calc(100dvh-210px)] overflow-auto rounded-xl border border-line bg-panel"
    >
      <div className="min-w-[940px]">
        <div className={cn("sticky top-0 z-10 grid border-b border-line bg-surface", COLS)}>
          <HeaderCell>Time</HeaderCell>
          <HeaderCell>Method</HeaderCell>
          <HeaderCell>Status</HeaderCell>
          <HeaderCell>Host / path</HeaderCell>
          <HeaderCell className="text-center">Geo</HeaderCell>
          <HeaderCell>Client IP</HeaderCell>
          <HeaderCell>PoP</HeaderCell>
          <HeaderCell>Cache</HeaderCell>
          <HeaderCell className="text-right">Latency</HeaderCell>
          <HeaderCell className="text-right">Bytes</HeaderCell>
        </div>

        {loading && rows.length === 0 && (
          <div className="space-y-1 p-3">
            {Array.from({ length: 18 }).map((_, i) => (
              <div key={i} className="h-7 w-full animate-pulse rounded bg-panel-2" />
            ))}
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div className="px-4 py-16 text-center text-xs text-faint">
            No log entries match the current filters.
          </div>
        )}

        <div style={{ height: virt.getTotalSize(), position: "relative" }}>
          {items.map((vi) => {
            const r = rows[vi.index];
            const selected = selectedRef === r.trackingRef;
            return (
              <div
                key={r.trackingRef}
                onClick={() => onRowClick(r)}
                className={cn(
                  "absolute left-0 top-0 grid w-full cursor-pointer items-center border-b border-line/40 text-xs transition-colors",
                  COLS,
                  selected ? "bg-accent/10" : "hover:bg-panel-2/50",
                )}
                style={{ height: vi.size, transform: `translateY(${vi.start}px)` }}
              >
                <div className="truncate px-2 font-mono text-[11px] text-muted tabular">
                  {fmtDateTime(r.timestamp)}
                </div>
                <div className="px-2 font-mono text-[11px] text-muted">{r.method}</div>
                <div className="px-2">
                  <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                </div>
                <div className="truncate px-2 font-mono">
                  <span className="text-faint">{r.host}</span>
                  <span className="text-foreground">{r.path}</span>
                </div>
                <div className="px-2 text-center" title={r.countryName}>
                  {flagEmoji(r.country)}
                </div>
                <div className="truncate px-2 font-mono text-[11px] text-muted">{r.clientIp}</div>
                <div className="px-2 text-[11px] text-muted">{r.pop}</div>
                <div
                  className={cn(
                    "truncate px-2 text-[11px]",
                    r.cacheStatus === "HIT" || r.cacheStatus === "REMOTE_HIT"
                      ? "text-success"
                      : r.cacheStatus === "MISS"
                        ? "text-warning"
                        : "text-faint",
                  )}
                >
                  {r.cacheStatus}
                </div>
                <div className="px-2 text-right text-[11px] text-muted tabular">
                  {fmtMs(r.timeTaken * 1000)}
                </div>
                <div className="px-2 text-right text-[11px] text-muted tabular">
                  {fmtBytes(r.responseBytes)}
                </div>
              </div>
            );
          })}
        </div>

        {isFetchingNextPage && (
          <div className="py-3 text-center text-xs text-faint">Loading more…</div>
        )}
      </div>
    </div>
  );
}
