"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { TimePoint } from "@/lib/domain/types";
import { fmtCompact, fmtDateTime, fmtInt, fmtMs, fmtTimeAxis } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Multi-metric correlation overlay: request volume (area) with 4xx and 5xx
 * counts and p95 latency drawn on top, on a shared time axis, so a latency or
 * error spike can be read against traffic at a glance. Volume and error counts
 * share the left count axis (directly comparable); p95 uses a right ms axis.
 * Every series comes straight from the timeseries the datasource returns, so it
 * is real on every source.
 */
export function MetricOverlay({ points, loading }: { points: TimePoint[]; loading?: boolean }) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const spanMs = useMemo(() => {
    if (points.length < 2) return 24 * 3600_000;
    return Date.parse(points[points.length - 1].t) - Date.parse(points[0].t);
  }, [points]);

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-2">Traffic, errors and latency</CardTitle>
        <Legend />
      </CardHeader>
      <CardContent className="pt-2">
        {!mounted || (loading && points.length === 0) ? (
          <Skeleton className="h-64 w-full" />
        ) : points.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-xs text-faint">
            No data in this range
          </div>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="ov-req" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" vertical={false} />
                <XAxis
                  dataKey="t"
                  tickFormatter={(t) => fmtTimeAxis(t, spanMs)}
                  tick={{ fill: "var(--color-faint)", fontSize: 11 }}
                  stroke="var(--color-line)"
                  minTickGap={36}
                />
                <YAxis
                  yAxisId="count"
                  tickFormatter={(v) => fmtCompact(v)}
                  tick={{ fill: "var(--color-faint)", fontSize: 11 }}
                  stroke="var(--color-line)"
                  width={44}
                />
                <YAxis
                  yAxisId="ms"
                  orientation="right"
                  tickFormatter={(v) => fmtMs(v)}
                  tick={{ fill: "var(--color-faint)", fontSize: 11 }}
                  stroke="var(--color-line)"
                  width={52}
                />
                <Tooltip content={<OverlayTooltip />} />
                <Area
                  yAxisId="count"
                  type="monotone"
                  dataKey="requests"
                  name="Requests"
                  stroke="var(--color-accent)"
                  strokeWidth={2}
                  fill="url(#ov-req)"
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="count"
                  type="monotone"
                  dataKey="status4xx"
                  name="4xx"
                  stroke="var(--color-warning)"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="count"
                  type="monotone"
                  dataKey="status5xx"
                  name="5xx"
                  stroke="var(--color-danger)"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="ms"
                  type="monotone"
                  dataKey="p95LatencyMs"
                  name="p95"
                  stroke="var(--color-info)"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const LEGEND_ITEMS = [
  { label: "Requests", color: "var(--color-accent)" },
  { label: "4xx", color: "var(--color-warning)" },
  { label: "5xx", color: "var(--color-danger)" },
  { label: "p95 (right)", color: "var(--color-info)" },
];

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
      {LEGEND_ITEMS.map((s) => (
        <span key={s.label} className="flex items-center gap-1">
          <span className="h-1.5 w-3 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

interface OverlayTooltipProps {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}

function OverlayTooltip({ active, payload, label }: OverlayTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-medium text-foreground">{label ? fmtDateTime(label) : ""}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-muted">
            <span className="size-2 rounded-sm" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="tabular text-foreground">
            {p.name === "p95" ? fmtMs(p.value) : fmtInt(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}
