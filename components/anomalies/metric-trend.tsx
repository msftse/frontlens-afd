"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Search } from "lucide-react";

import type { TimePoint } from "@/lib/domain/types";
import { METRIC_CONFIG, detectSpikes, seriesFor, type MetricKey } from "@/lib/anomaly";
import { fmtCompact, fmtDateTime, fmtInt, fmtMs, fmtPct, fmtTimeAxis } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

function isRate(m: MetricKey): boolean {
  return m === "cacheHitRatio" || m === "errorRate4xx" || m === "errorRate5xx";
}
function isLatency(m: MetricKey): boolean {
  return m === "p95LatencyMs" || m === "avgLatencyMs";
}
/** Compact formatter for the Y axis. */
function axisFmt(m: MetricKey): (v: number) => string {
  if (isRate(m)) return (v) => fmtPct(v, 0);
  if (isLatency(m)) return (v) => fmtMs(v);
  return (v) => fmtCompact(v);
}
/** Precise formatter for the tooltip. */
function valueFmt(m: MetricKey): (v: number) => string {
  if (isRate(m)) return (v) => fmtPct(v, 2);
  if (isLatency(m)) return (v) => fmtMs(v);
  return (v) => fmtInt(v);
}
function metricColor(m: MetricKey): string {
  if (m === "errorRate5xx") return "var(--color-danger)";
  if (m === "errorRate4xx" || isLatency(m)) return "var(--color-warning)";
  if (m === "cacheHitRatio") return "var(--color-info)";
  return "var(--color-accent)";
}

/**
 * Focused single-series trend for one KPI, with the in-window spike (median/MAD
 * outliers) highlighted as a ReferenceArea and a "Zoom to spike" button that
 * narrows the global time range to the spike window.
 */
export function MetricTrend({
  metric,
  points,
  onZoom,
  loading,
}: {
  metric: MetricKey;
  points: TimePoint[];
  onZoom: (from: string, to: string) => void;
  loading?: boolean;
}) {
  // Render only on the client so ResponsiveContainer can measure (no SSR 0×0).
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const series = useMemo(() => seriesFor(points, metric), [points, metric]);
  const spike = useMemo(() => detectSpikes(series), [series]);
  const data = useMemo(() => points.map((p, i) => ({ t: p.t, v: series[i] })), [points, series]);
  const spanMs = useMemo(() => {
    if (points.length < 2) return 24 * 3600_000;
    return Date.parse(points[points.length - 1].t) - Date.parse(points[0].t);
  }, [points]);

  const cfg = METRIC_CONFIG.find((c) => c.key === metric) ?? METRIC_CONFIG[0];
  const color = metricColor(metric);
  const spikeFill = metric === "errorRate5xx" ? "var(--color-danger)" : "var(--color-warning)";
  const win = spike.window;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">{cfg.label} over time</CardTitle>
        {win && (
          <Button
            size="sm"
            variant="subtle"
            onClick={() => onZoom(points[win.startIdx].t, points[win.endIdx].t)}
          >
            <Search className="size-3" />
            Zoom to spike
          </Button>
        )}
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
              <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`trend-${metric}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.02} />
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
                  tickFormatter={axisFmt(metric)}
                  tick={{ fill: "var(--color-faint)", fontSize: 11 }}
                  stroke="var(--color-line)"
                  width={48}
                />
                <Tooltip content={<TrendTooltip metric={metric} color={color} name={cfg.label} />} />
                {win && (
                  <ReferenceArea
                    x1={points[win.startIdx].t}
                    x2={points[win.endIdx].t}
                    fill={spikeFill}
                    fillOpacity={0.12}
                    stroke={spikeFill}
                    strokeOpacity={0.25}
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="v"
                  name={cfg.label}
                  stroke={color}
                  strokeWidth={2}
                  fill={`url(#trend-${metric})`}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface TrendTooltipProps {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
  metric: MetricKey;
  color: string;
  name: string;
}

function TrendTooltip({ active, payload, label, metric, color, name }: TrendTooltipProps) {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  return (
    <div className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-medium text-foreground">{label ? fmtDateTime(label) : ""}</div>
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-1.5 text-muted">
          <span className="size-2 rounded-sm" style={{ background: color }} />
          {name}
        </span>
        <span className="tabular text-foreground">{valueFmt(metric)(v)}</span>
      </div>
    </div>
  );
}
