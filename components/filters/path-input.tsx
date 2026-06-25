"use client";

import { useState } from "react";
import { CornerDownLeft, Slash } from "lucide-react";

import { PATH_MATCH_MODES, type PathMatchMode, type PathPattern } from "@/lib/filters/model";
import { cn } from "@/lib/utils";

const MODE_LABEL: Record<PathMatchMode, string> = {
  prefix: "starts with",
  exact: "equals",
  glob: "glob",
  regex: "regex",
};

/**
 * The headline input: type a URL path/pattern (e.g. `nadav.com/api`, `/api/*`,
 * or a regex) and add it as a filter. Matches host+path and bare path.
 */
export function PathInput({ onAdd }: { onAdd: (p: PathPattern) => void }) {
  const [mode, setMode] = useState<PathMatchMode>("prefix");
  const [value, setValue] = useState("");

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    onAdd({ mode, value: v });
    setValue("");
  };

  return (
    <div className="flex h-8 items-center rounded-lg border border-line bg-surface focus-within:border-accent/50">
      <Slash className="ml-2 size-3.5 text-faint" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder="Filter by path: nadav.com/api, /api/*, regex…"
        className="h-full w-64 bg-transparent px-2 text-xs text-foreground outline-none placeholder:text-faint"
      />
      <select
        value={mode}
        onChange={(e) => setMode(e.target.value as PathMatchMode)}
        className="h-full cursor-pointer border-l border-line bg-transparent px-1.5 text-[11px] text-muted outline-none hover:text-foreground"
        title="Match mode"
      >
        {PATH_MATCH_MODES.map((m) => (
          <option key={m} value={m} className="bg-panel-2 text-foreground">
            {MODE_LABEL[m]}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={submit}
        disabled={!value.trim()}
        className={cn(
          "flex h-full items-center rounded-r-lg border-l border-line px-2 text-faint transition-colors",
          value.trim() ? "hover:bg-panel-2 hover:text-accent" : "opacity-40",
        )}
        title="Add path filter (Enter)"
      >
        <CornerDownLeft className="size-3.5" />
      </button>
    </div>
  );
}
