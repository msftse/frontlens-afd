"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { FlaskConical, Radio } from "lucide-react";

import { cn } from "@/lib/utils";
import { setSelectedSource, useSelectedSource } from "@/lib/api/source";

interface SourcesInfo {
  default: string;
  available: string[];
}

const META: Record<string, { label: string; short: string }> = {
  mock: { label: "Demo data", short: "Demo" },
  loganalytics: { label: "Live · Front Door", short: "Live" },
  clickhouse: { label: "Live · ClickHouse", short: "Live" },
};

/**
 * Demo/Live data-source switch. The choice is persisted client-side (localStorage,
 * via the source store) so it survives navigation between pages and full reloads,
 * and is mirrored into every `/api/query` request body (and the react-query cache
 * key, so switching refetches). An inbound `?source=` query param is still honored
 * as a shareable deep link. Only renders when the deployment exposes >1 source.
 */
export function SourceToggle() {
  const { data } = useQuery<SourcesInfo>({
    queryKey: ["sources"],
    queryFn: async () => {
      const res = await fetch("/api/sources");
      if (!res.ok) throw new Error("failed to load sources");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  // A shareable `?source=` deep link seeds the choice once; after that the
  // persisted store is the source of truth, so navigating between pages (which
  // drops the query param) no longer resets the toggle back to the default.
  const [urlSource] = useQueryState("source");
  const selected = useSelectedSource();

  useEffect(() => {
    if (urlSource) setSelectedSource(urlSource);
  }, [urlSource]);

  const available = data?.available ?? [];
  if (available.length < 2) return null;

  const active = selected && available.includes(selected) ? selected : (data?.default ?? "mock");

  return (
    <div className="flex h-8 items-center rounded-lg border border-line bg-surface p-0.5">
      {available.map((kind) => {
        const meta = META[kind] ?? { label: kind, short: kind };
        const isActive = kind === active;
        const live = kind !== "mock";
        const Icon = live ? Radio : FlaskConical;
        return (
          <button
            key={kind}
            type="button"
            title={meta.label}
            aria-pressed={isActive}
            onClick={() => setSelectedSource(kind === data?.default ? null : kind)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              isActive
                ? live
                  ? "bg-success/15 text-success"
                  : "bg-accent/15 text-accent"
                : "text-faint hover:text-muted",
            )}
          >
            <Icon className="size-3.5" />
            {meta.short}
          </button>
        );
      })}
    </div>
  );
}
