"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { TimePoint } from "@/lib/domain/types";
import { fmtCompact, fmtDateTime, fmtInt, fmtTimeAxis } from "@/lib/format";

const SERIES = [
  { key: "status2xx", label: "2xx", color: "var(--color-success)" },
  { key: "status3xx", label: "3xx", color: "var(--color-info)" },
  { key: "status4xx", label: "4xx", color: "var(--color-warning)" },
  { key: "status5xx", label: "5xx", color: "var(--color-danger)" },
] as const;

export function TimeseriesChart({ data }: { data: TimePoint[] }) {
  // Render only on the client so ResponsiveContainer can measure (no SSR 0×0 warning).
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const spanMs = useMemo(() => {
    if (data.length < 2) return 24 * 3600_000;
    return Date.parse(data[data.length - 1].t) - Date.parse(data[0].t);
  }, [data]);

  if (!mounted) return <div className="h-72 w-full" />;

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            {SERIES.map((s) => (
              <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.4} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.03} />
              </linearGradient>
            ))}
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
            tickFormatter={(v) => fmtCompact(v)}
            tick={{ fill: "var(--color-faint)", fontSize: 11 }}
            stroke="var(--color-line)"
            width={44}
          />
          <Tooltip content={<ChartTooltip />} />
          {SERIES.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stackId="1"
              stroke={s.color}
              strokeWidth={2}
              fill={`url(#g-${s.key})`}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

interface TooltipProps {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}

function ChartTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-medium text-foreground">{label ? fmtDateTime(label) : ""}</div>
      <div className="mb-1.5 flex items-center justify-between gap-4 border-b border-line pb-1.5">
        <span className="text-faint">Requests</span>
        <span className="font-semibold tabular">{fmtInt(total)}</span>
      </div>
      {payload
        .slice()
        .reverse()
        .map((p) => (
          <div key={p.name} className="flex items-center justify-between gap-4 py-0.5">
            <span className="flex items-center gap-1.5 text-muted">
              <span className="size-2 rounded-sm" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="tabular text-foreground">{fmtInt(p.value)}</span>
          </div>
        ))}
    </div>
  );
}
