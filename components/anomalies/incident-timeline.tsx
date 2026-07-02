"use client";

import { useMemo } from "react";

import type { Incident } from "@/lib/anomaly";
import { fmtDateTime, fmtTimeAxis } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Severity → marker color (matches the incident feed badges). */
function markerColor(sev: number): string {
  if (sev >= 0.66) return "var(--color-danger)";
  if (sev >= 0.33) return "var(--color-warning)";
  return "var(--color-info)";
}

interface Placed {
  incident: Incident;
  /** Left edge and width as percentages of the window span. */
  leftPct: number;
  widthPct: number;
}

/**
 * Compact horizontal band spanning the analysis window that plots every
 * detected incident as a severity-colored segment. Gives an at-a-glance "when
 * did things go wrong" strip above the trend; clicking a segment investigates
 * that incident. Purely derived from incident timings and the window bounds.
 */
export function IncidentTimeline({
  incidents,
  windowStart,
  windowEnd,
  onInvestigate,
}: {
  incidents: Incident[];
  /** ISO bounds of the loaded window (first and last bucket timestamps). */
  windowStart?: string;
  windowEnd?: string;
  onInvestigate: (incident: Incident) => void;
}) {
  const { from, to, span } = useMemo(() => {
    const f = windowStart ? Date.parse(windowStart) : NaN;
    const t = windowEnd ? Date.parse(windowEnd) : NaN;
    const s = Number.isFinite(f) && Number.isFinite(t) && t > f ? t - f : 0;
    return { from: f, to: t, span: s };
  }, [windowStart, windowEnd]);

  const placed: Placed[] = useMemo(() => {
    if (!span) return [];
    return incidents.map((inc) => {
      const s = Date.parse(inc.startTime);
      const e = Date.parse(inc.endTime);
      const leftPct = Math.min(98.8, Math.max(0, ((s - from) / span) * 100));
      // Ensure single-bucket incidents stay visible (min width) but never let a
      // segment run past the track's right edge (left + width <= 100).
      const rawWidth = ((e - s) / span) * 100;
      const widthPct = Math.min(100 - leftPct, Math.max(1.2, rawWidth));
      return { incident: inc, leftPct, widthPct };
    });
  }, [incidents, from, span]);

  if (!span) return null;

  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="mb-1 flex items-center justify-between text-[11px] text-faint">
        <span>{fmtTimeAxis(new Date(from).toISOString(), span)}</span>
        <span className="font-medium text-muted">
          {placed.length === 0
            ? "No incidents in window"
            : `${placed.length} incident${placed.length === 1 ? "" : "s"}`}
        </span>
        <span>{fmtTimeAxis(new Date(to).toISOString(), span)}</span>
      </div>
      <div className="relative h-6 w-full overflow-hidden rounded bg-panel-2">
        {/* Subtle mid-line for context. */}
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" />
        {placed.map((p) => (
          <button
            key={`${p.incident.metric}:${p.incident.startTime}`}
            type="button"
            title={`${p.incident.label} · ${fmtDateTime(p.incident.startTime)} · ${p.incident.peakScore.toFixed(
              1,
            )}σ`}
            onClick={() => onInvestigate(p.incident)}
            className={cn(
              "absolute top-1/2 h-4 -translate-y-1/2 rounded-sm opacity-80 ring-1 ring-inset ring-black/10 transition-opacity hover:opacity-100",
            )}
            style={{
              left: `${p.leftPct}%`,
              width: `${p.widthPct}%`,
              background: markerColor(p.incident.severity),
            }}
          />
        ))}
      </div>
    </div>
  );
}
