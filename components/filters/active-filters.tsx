"use client";

import { X } from "lucide-react";

import type { UseFiltersReturn } from "@/lib/filters/use-filters";
import { PATH_MATCH_MODES } from "@/lib/filters/model";
import { flagEmoji } from "@/lib/format";
import { cn } from "@/lib/utils";

const FACET_LABELS: Record<string, string> = {
  host: "host",
  country: "country",
  city: "city",
  asnOrg: "org",
  clientIp: "ip",
  cidr: "cidr",
  method: "method",
  uaFamily: "browser",
  deviceType: "device",
  pop: "pop",
  cacheStatus: "cache",
  ja4: "ja4",
  referer: "referer",
};

const ARRAY_KEYS = Object.keys(FACET_LABELS) as (keyof typeof FACET_LABELS)[];

function Chip({
  children,
  onRemove,
  tone = "default",
}: {
  children: React.ReactNode;
  onRemove: () => void;
  tone?: "default" | "accent";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border py-0.5 pl-2 pr-1 text-xs",
        tone === "accent"
          ? "border-accent/40 bg-accent/10 text-foreground"
          : "border-line bg-panel-2 text-foreground",
      )}
    >
      {children}
      <button
        type="button"
        onClick={onRemove}
        className="rounded p-0.5 text-faint transition-colors hover:bg-line hover:text-danger"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

export function ActiveFilters({ f }: { f: UseFiltersReturn }) {
  const { filter, setRaw, removePath, toggleStatus, clearAll } = f;

  const chips: React.ReactNode[] = [];

  filter.path.forEach((p, i) => {
    chips.push(
      <Chip key={`path-${i}`} tone="accent" onRemove={() => removePath(i)}>
        <span className="text-faint">{p.negate ? "not " : ""}path {PATH_MATCH_MODES.includes(p.mode) ? p.mode : ""}:</span>
        <span className="font-medium">{p.value}</span>
      </Chip>,
    );
  });

  filter.status.forEach((s) => {
    chips.push(
      <Chip key={`status-${s}`} onRemove={() => toggleStatus(s)}>
        <span className="text-faint">status:</span>
        <span className="font-medium tabular">{String(s)}</span>
      </Chip>,
    );
  });

  for (const key of ARRAY_KEYS) {
    const values = (filter[key as keyof typeof filter] as string[]) ?? [];
    values.forEach((value) => {
      chips.push(
        <Chip
          key={`${key}-${value}`}
          onRemove={() =>
            setRaw({ [key]: values.filter((v) => v !== value) } as Record<string, string[]>)
          }
        >
          <span className="text-faint">{FACET_LABELS[key]}:</span>
          <span className="font-medium">
            {key === "country" ? `${flagEmoji(value)} ${value}` : value}
          </span>
        </Chip>,
      );
    });
  }

  if (filter.q) {
    chips.push(
      <Chip key="q" onRemove={() => setRaw({ q: null })}>
        <span className="text-faint">search:</span>
        <span className="font-medium">{filter.q}</span>
      </Chip>,
    );
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips}
      <button
        type="button"
        onClick={clearAll}
        className="ml-1 text-xs font-medium text-faint underline-offset-2 hover:text-danger hover:underline"
      >
        Clear all
      </button>
    </div>
  );
}
