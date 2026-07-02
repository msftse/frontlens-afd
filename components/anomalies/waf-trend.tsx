"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { WafTimePoint } from "@/lib/domain/types";
import { detectSpikes } from "@/lib/anomaly";
import { fmtCompact, fmtDateTime, fmtInt, fmtPct, fmtTimeAxis } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Row {
  t: string;
  total: number;
  blocked: number;
  blockRate: number;
}

/**
 * WAF activity over time: total evaluations (area) with enforced blocks (line)
 * and a block-rate outlier window highlighted (MAD spike over the per-bucket
 * block rate). The security counterpart to the traffic trend - a block-rate
 * spike marks a likely attack burst. Every series is real on Live and mock.
 */
export function WafTrend({ points, loading }: { points: WafTimePoint[]; loading?: boolean }) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const data: Row[] = useMemo(
    () =>
      points.map((p) => ({
        t: p.t,
        total: p.total,
        blocked: p.blocked,
        blockRate: p.total ? p.blocked / p.total : 0,
      })),
    [points],
  );

  const spike = useMemo(() => detectSpikes(data.map((d) => d.blockRate)), [data]);
  const spanMs = useMemo(() => {
    if (points.length < 2) return 24 * 3600_000;
    return Date.parse(points[points.length - 1].t) - Date.parse(points[0].t);
  }, [points]);
  const win = spike.window;

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle>WAF activity and block rate</CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        {!mounted || (loading && points.length === 0) ? (
          <Skeleton className="h-56 w-full" />
        ) : points.length === 0 ? (
          <div className="flex h-56 items-center justify-center text-xs text-faint">
            No WAF activity in this range
          </div>
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="waf-total" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-info)" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="var(--color-info)" stopOpacity={0.02} />
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
                  yAxisId="rate"
                  orientation="right"
                  domain={[0, 1]}
                  tickFormatter={(v) => fmtPct(v, 0)}
                  tick={{ fill: "var(--color-faint)", fontSize: 11 }}
                  stroke="var(--color-line)"
                  width={44}
                />
                <Tooltip content={<WafTooltip />} />
                {win && (
                  <ReferenceArea
                    yAxisId="count"
                    x1={data[win.startIdx].t}
                    x2={data[win.endIdx].t}
                    fill="var(--color-danger)"
                    fillOpacity={0.12}
                    stroke="var(--color-danger)"
                    strokeOpacity={0.25}
                  />
                )}
                <Area
                  yAxisId="count"
                  type="monotone"
                  dataKey="total"
                  name="WAF events"
                  stroke="var(--color-info)"
                  strokeWidth={2}
                  fill="url(#waf-total)"
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="count"
                  type="monotone"
                  dataKey="blocked"
                  name="Blocked"
                  stroke="var(--color-danger)"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="rate"
                  type="monotone"
                  dataKey="blockRate"
                  name="Block rate"
                  stroke="var(--color-warning)"
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

interface WafTooltipProps {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}

function WafTooltip({ active, payload, label }: WafTooltipProps) {
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
            {p.name === "Block rate" ? fmtPct(p.value, 1) : fmtInt(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}
