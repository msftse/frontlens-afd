"use client";

import { useState } from "react";
import { Layers, Route } from "lucide-react";

import { useFilters } from "@/lib/filters/use-filters";
import { usePaths } from "@/lib/api/hooks";
import type { PathRow } from "@/lib/domain/types";
import { fmtInt } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { PathTable, pathKey, type PathSortKey } from "@/components/paths/path-table";
import { WhoPanel } from "@/components/paths/who-panel";
import { CompareBar } from "@/components/paths/compare-bar";

interface Item {
  host: string;
  path: string;
}

export default function PathExplorerPage() {
  const fh = useFilters();
  const { filter } = fh;

  const [depth, setDepth] = useState(0);
  const [sortBy, setSortBy] = useState<PathSortKey>("requests");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<Item | null>(null);
  const [compare, setCompare] = useState<Item[]>([]);

  const { data, isLoading } = usePaths(filter, { depth, sortBy, sortDir, limit: 200 });
  const rows = data?.rows ?? [];

  const onSort = (k: PathSortKey) => {
    if (k === sortBy) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortBy(k);
      setSortDir("desc");
    }
  };

  const onToggleCompare = (r: PathRow) => {
    const item = { host: r.host, path: r.path };
    setCompare((prev) => {
      const exists = prev.some((p) => p.host === item.host && p.path === item.path);
      if (exists) return prev.filter((p) => !(p.host === item.host && p.path === item.path));
      return prev.length >= 3 ? prev : [...prev, item];
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Path Explorer"
        description="Match any URL (exact, prefix, glob or regex), then see exactly who hit it."
        actions={
          <label className="flex items-center gap-2 text-xs text-muted">
            <Layers className="size-3.5 text-faint" />
            Group by
            <select
              value={depth}
              onChange={(e) => {
                setDepth(Number(e.target.value));
                setSelected(null);
              }}
              className="h-8 cursor-pointer rounded-lg border border-line bg-surface px-2 text-xs text-foreground outline-none"
            >
              <option value={0}>Full path</option>
              <option value={1}>1 segment</option>
              <option value={2}>2 segments</option>
              <option value={3}>3 segments</option>
            </select>
          </label>
        }
      />

      <CompareBar
        filter={filter}
        items={compare}
        onRemove={(item) =>
          setCompare((prev) => prev.filter((p) => !(p.host === item.host && p.path === item.path)))
        }
        onClear={() => setCompare([])}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1 text-xs text-faint">
            <span className="flex items-center gap-1.5">
              <Route className="size-3.5" />
              {isLoading ? "Loading paths…" : `${fmtInt(data?.total ?? 0)} distinct paths`}
            </span>
            <span>Click a row to see who hit it · compare icon to stack up to 3</span>
          </div>
          <PathTable
            rows={rows}
            loading={isLoading}
            selectedKey={selected ? `${selected.host}${selected.path}` : null}
            onSelect={(r) => setSelected({ host: r.host, path: r.path })}
            compareKeys={compare.map((c) => pathKey(c))}
            onToggleCompare={onToggleCompare}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={onSort}
          />
        </div>

        <div className="xl:sticky xl:top-28 xl:self-start">
          <WhoPanel
            filter={filter}
            selected={selected}
            onAddPathFilter={(host, path) => fh.addPath({ mode: "exact", value: `${host}${path}` })}
            onClear={() => setSelected(null)}
          />
        </div>
      </div>
    </div>
  );
}
