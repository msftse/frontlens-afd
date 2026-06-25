"use client";

import { Globe2, Search, Server, SlidersHorizontal } from "lucide-react";

import { useFilters } from "@/lib/filters/use-filters";
import { countActiveFacets } from "@/lib/filters/model";
import { flagEmoji } from "@/lib/format";
import { TimeRange } from "@/components/filters/time-range";
import { PathInput } from "@/components/filters/path-input";
import { FacetSelect } from "@/components/filters/facet-select";
import { ActiveFilters } from "@/components/filters/active-filters";
import { SavedViews } from "@/components/filters/saved-views";
import { SourceToggle } from "@/components/filters/source-toggle";

export function FilterBar() {
  const f = useFilters();
  const { filter } = f;
  const activeCount = countActiveFacets(filter);

  return (
    <div className="sticky top-0 z-40 border-b border-line bg-surface/80 backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 lg:px-6">
        <TimeRange
          value={filter.range}
          custom={!!(filter.from && filter.to)}
          from={filter.from}
          to={filter.to}
          onChange={f.setRange}
          onCustom={f.setCustomRange}
        />

        <PathInput onAdd={f.addPath} />

        <FacetSelect
          label="Host"
          icon={Server}
          dimension="host"
          filterForOptions={{ ...filter, host: [] }}
          selected={filter.host}
          onToggle={(v) => f.toggle("host", v)}
        />

        <FacetSelect
          label="Country"
          icon={Globe2}
          dimension="country"
          filterForOptions={{ ...filter, country: [] }}
          selected={filter.country}
          onToggle={(v) => f.toggle("country", v)}
          renderLabel={(row) => (
            <span>
              <span className="mr-1.5">{flagEmoji(row.key)}</span>
              {row.label}
            </span>
          )}
        />

        <div className="ml-auto flex items-center gap-2">
          <label className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 focus-within:border-accent/50">
            <Search className="size-3.5 text-faint" />
            <input
              defaultValue={filter.q ?? ""}
              key={filter.q ?? ""}
              onChange={(e) => f.setSearch(e.target.value)}
              placeholder="Search url, IP, UA…"
              className="w-44 bg-transparent text-xs text-foreground outline-none placeholder:text-faint"
            />
          </label>
          <span className="flex items-center gap-1 text-xs text-faint">
            <SlidersHorizontal className="size-3.5" />
            {activeCount}
          </span>
          <SourceToggle />
          <SavedViews />
        </div>
      </div>

      {activeCount > 0 && (
        <div className="px-4 pb-2.5 lg:px-6">
          <ActiveFilters f={f} />
        </div>
      )}
    </div>
  );
}
