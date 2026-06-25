"use client";

import { useState } from "react";
import { CalendarRange, Clock } from "lucide-react";

import { TIME_PRESETS, type TimePreset } from "@/lib/filters/model";
import { cn } from "@/lib/utils";
import { Popover } from "@/components/ui/popover";

const pad = (n: number) => String(n).padStart(2, "0");

/** A Date → value for <input type="datetime-local"> in the user's local tz. */
function toLocalInput(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** ISO (or undefined) → datetime-local value, falling back to `fallback`. */
function isoToLocalInput(iso: string | undefined, fallback: Date): string {
  const d = iso ? new Date(iso) : fallback;
  return toLocalInput(Number.isNaN(d.getTime()) ? fallback : d);
}

function fmtShort(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function TimeRange({
  value,
  custom,
  from,
  to,
  onChange,
  onCustom,
}: {
  value: TimePreset;
  custom: boolean;
  from?: string;
  to?: string;
  onChange: (p: TimePreset) => void;
  onCustom: (from: string, to: string) => void;
}) {
  const presets = Object.entries(TIME_PRESETS) as [TimePreset, { label: string; ms: number }][];

  return (
    <div className="flex items-center gap-1 rounded-lg border border-line bg-surface p-0.5">
      <Clock className="ml-1.5 size-3.5 text-faint" />
      {presets.map(([key]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            "rounded-md px-2 py-1 text-xs font-medium transition-colors tabular",
            !custom && value === key
              ? "bg-accent text-accent-foreground"
              : "text-muted hover:bg-panel-2 hover:text-foreground",
          )}
        >
          {key}
        </button>
      ))}

      <Popover
        width={296}
        trigger={
          <span
            title="Custom range"
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
              custom
                ? "bg-accent text-accent-foreground"
                : "text-muted hover:bg-panel-2 hover:text-foreground",
            )}
          >
            <CalendarRange className="size-3.5" />
            {custom && from && to ? (
              <span className="tabular">
                {fmtShort(from)} <span className="opacity-70">→</span> {fmtShort(to)}
              </span>
            ) : (
              "Custom"
            )}
          </span>
        }
      >
        {(close) => (
          <CustomRange
            preset={value}
            from={from}
            to={to}
            onApply={(f, t) => {
              onCustom(f, t);
              close();
            }}
          />
        )}
      </Popover>
    </div>
  );
}

function CustomRange({
  preset,
  from,
  to,
  onApply,
}: {
  preset: TimePreset;
  from?: string;
  to?: string;
  onApply: (from: string, to: string) => void;
}) {
  const now = new Date();
  const defFrom = new Date(now.getTime() - TIME_PRESETS[preset].ms);
  const [f, setF] = useState(() => isoToLocalInput(from, defFrom));
  const [t, setT] = useState(() => isoToLocalInput(to, now));

  const fromDate = new Date(f);
  const toDate = new Date(t);
  const valid =
    f !== "" &&
    t !== "" &&
    !Number.isNaN(fromDate.getTime()) &&
    !Number.isNaN(toDate.getTime()) &&
    fromDate < toDate;

  const inputCls =
    "h-8 w-full rounded-lg border border-line bg-surface px-2 text-xs text-foreground outline-none focus:border-accent/50 [color-scheme:dark]";

  return (
    <div className="space-y-2 p-2">
      <label className="block space-y-1">
        <span className="text-[11px] font-medium text-faint">From</span>
        <input
          type="datetime-local"
          value={f}
          max={t || undefined}
          onChange={(e) => setF(e.target.value)}
          className={inputCls}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-[11px] font-medium text-faint">To</span>
        <input
          type="datetime-local"
          value={t}
          min={f || undefined}
          onChange={(e) => setT(e.target.value)}
          className={inputCls}
        />
      </label>
      {!valid && <p className="px-0.5 text-[11px] text-warning">Pick a start before the end.</p>}
      <button
        type="button"
        disabled={!valid}
        onClick={() => onApply(fromDate.toISOString(), toDate.toISOString())}
        className={cn(
          "h-8 w-full rounded-lg text-xs font-medium transition-colors",
          valid
            ? "bg-accent text-accent-foreground hover:bg-accent/90"
            : "cursor-not-allowed bg-panel-2 text-faint",
        )}
      >
        Apply range
      </button>
    </div>
  );
}
