"use client";

import { useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

import type { Dimension, TopNRow } from "@/lib/domain/types";
import type { Filter } from "@/lib/filters/model";
import { useFacetValues } from "@/lib/api/hooks";
import { fmtCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Popover } from "@/components/ui/popover";

export function FacetSelect({
  label,
  icon: Icon,
  dimension,
  filterForOptions,
  selected,
  onToggle,
  renderLabel,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  dimension: Dimension;
  filterForOptions: Filter;
  selected: string[];
  onToggle: (value: string) => void;
  renderLabel?: (row: TopNRow) => React.ReactNode;
}) {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useFacetValues(filterForOptions, dimension, 200);
  const rows = (data ?? []).filter(
    (r) => !search || r.label.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Popover
      width={280}
      trigger={
        <span
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors cursor-pointer",
            selected.length
              ? "border-accent/40 bg-accent/10 text-foreground"
              : "border-line bg-surface text-muted hover:text-foreground hover:bg-panel-2",
          )}
        >
          {Icon && <Icon className="size-3.5" />}
          {label}
          {selected.length > 0 && (
            <span className="rounded bg-accent/20 px-1 text-[10px] text-accent tabular">
              {selected.length}
            </span>
          )}
          <ChevronDown className="size-3 text-faint" />
        </span>
      }
    >
      <div className="flex items-center gap-1.5 border-b border-line px-2 pb-1.5 pt-1">
        <Search className="size-3.5 text-faint" />
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${label.toLowerCase()}…`}
          className="w-full bg-transparent py-1 text-xs text-foreground outline-none placeholder:text-faint"
        />
      </div>
      <div className="max-h-72 overflow-auto py-1">
        {isLoading && <div className="px-2 py-3 text-xs text-faint">Loading…</div>}
        {!isLoading && rows.length === 0 && (
          <div className="px-2 py-3 text-xs text-faint">No matches</div>
        )}
        {rows.map((row) => {
          const checked = selected.includes(row.key);
          return (
            <button
              key={row.key}
              type="button"
              onClick={() => onToggle(row.key)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-panel"
            >
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded border",
                  checked ? "border-accent bg-accent text-accent-foreground" : "border-line-strong",
                )}
              >
                {checked && <Check className="size-3" />}
              </span>
              <span className="flex-1 truncate text-foreground">
                {renderLabel ? renderLabel(row) : row.label}
              </span>
              <span className="shrink-0 text-faint tabular">{fmtCompact(row.requests)}</span>
            </button>
          );
        })}
      </div>
    </Popover>
  );
}
