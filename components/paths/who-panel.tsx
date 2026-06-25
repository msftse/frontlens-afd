"use client";

import { Filter as FilterIcon, Users, X } from "lucide-react";

import type { Filter } from "@/lib/filters/model";
import { usePathVisitors } from "@/lib/api/hooks";
import { fmtInt } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { VisitorList } from "@/components/visitors/visitor-list";

export function WhoPanel({
  filter,
  selected,
  onAddPathFilter,
  onClear,
}: {
  filter: Filter;
  selected: { host: string; path: string } | null;
  onAddPathFilter: (host: string, path: string) => void;
  onClear: () => void;
}) {
  const { data, isLoading } = usePathVisitors(
    filter,
    selected?.host ?? "",
    selected?.path ?? "",
    { limit: 200 },
    !!selected,
  );

  if (!selected) {
    return (
      <div className="panel flex h-full min-h-[300px] flex-col items-center justify-center px-6 text-center">
        <Users className="mb-3 size-7 text-faint" />
        <p className="text-sm font-medium text-foreground">Who hit it?</p>
        <p className="mt-1 text-xs text-muted">
          Select a path on the left to see every visitor that requested it — IP, country, org,
          device and request counts.
        </p>
      </div>
    );
  }

  return (
    <div className="panel flex h-full flex-col">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-faint">Who hit</div>
            <div className="truncate font-mono text-sm">
              <span className="text-faint">{selected.host}</span>
              <span className="text-foreground">{selected.path}</span>
            </div>
          </div>
          <button onClick={onClear} className="rounded p-1 text-faint hover:bg-panel-2 hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-2 flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1 text-muted">
            <Users className="size-3.5 text-accent" />
            <span className="font-semibold tabular text-foreground">{fmtInt(data?.total ?? 0)}</span>
            visitors
          </span>
          <Button
            size="sm"
            variant="subtle"
            onClick={() => onAddPathFilter(selected.host, selected.path)}
          >
            <FilterIcon className="size-3" />
            Filter everything to this path
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <VisitorList rows={data?.rows ?? []} loading={isLoading} />
      </div>
    </div>
  );
}
