"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bookmark, Check, Plus, Trash2 } from "lucide-react";

import { useSavedViews } from "@/lib/saved-views";
import { Popover } from "@/components/ui/popover";

export function SavedViews() {
  const { views, save, remove } = useSavedViews();
  const router = useRouter();
  const pathname = usePathname();
  const [name, setName] = useState("");

  const currentSearch = () =>
    typeof window !== "undefined" ? window.location.search.replace(/^\?/, "") : "";

  const apply = (search: string) =>
    router.replace(`${pathname}${search ? `?${search}` : ""}`);

  const onSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    save(trimmed, currentSearch());
    setName("");
  };

  return (
    <Popover
      align="end"
      width={260}
      trigger={
        <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-xs font-medium text-muted transition-colors hover:bg-panel-2 hover:text-foreground">
          <Bookmark className="size-3.5" />
          Views
          {views.length > 0 && (
            <span className="rounded bg-panel px-1 text-[10px] text-faint tabular">{views.length}</span>
          )}
        </span>
      }
    >
      <div className="flex items-center gap-1 border-b border-line p-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSave()}
          placeholder="Save current view as…"
          className="w-full bg-transparent px-1.5 py-1 text-xs text-foreground outline-none placeholder:text-faint"
        />
        <button
          onClick={onSave}
          disabled={!name.trim()}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-faint hover:bg-panel hover:text-accent disabled:opacity-40"
          title="Save view"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <div className="max-h-64 overflow-auto py-1">
        {views.length === 0 && (
          <div className="px-2 py-3 text-center text-xs text-faint">No saved views yet</div>
        )}
        {views.map((v) => (
          <div key={v.id} className="group flex items-center gap-1 rounded-md px-1 hover:bg-panel">
            <button
              onClick={() => apply(v.search)}
              className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1.5 text-left text-xs text-foreground"
            >
              <Check className="size-3 shrink-0 text-faint" />
              <span className="truncate">{v.name}</span>
            </button>
            <button
              onClick={() => remove(v.id)}
              className="flex size-6 shrink-0 items-center justify-center rounded text-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
              title="Delete"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        ))}
      </div>
    </Popover>
  );
}
