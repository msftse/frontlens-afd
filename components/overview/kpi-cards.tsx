"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import type { Summary } from "@/lib/domain/types";
import { type MetricAnomaly, scoreMetricAnomaly } from "@/lib/anomaly";
import { fmtBytes, fmtInt, fmtMs, fmtPct } from "@/lib/format";
import { Delta } from "@/components/ui/delta";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type MetricKey = keyof Omit<Summary, "delta">;

const METRICS: {
  key: MetricKey;
  label: string;
  fmt: (s: Summary) => string;
  goodWhenUp: boolean;
}[] = [
  { key: "requests", label: "Requests", fmt: (s) => fmtInt(s.requests), goodWhenUp: true },
  { key: "uniqueVisitors", label: "Unique visitors", fmt: (s) => fmtInt(s.uniqueVisitors), goodWhenUp: true },
  { key: "bytes", label: "Data transferred", fmt: (s) => fmtBytes(s.bytes), goodWhenUp: true },
  { key: "cacheHitRatio", label: "Cache hit ratio", fmt: (s) => fmtPct(s.cacheHitRatio), goodWhenUp: true },
  { key: "errorRate4xx", label: "4xx rate", fmt: (s) => fmtPct(s.errorRate4xx, 2), goodWhenUp: false },
  { key: "errorRate5xx", label: "5xx rate", fmt: (s) => fmtPct(s.errorRate5xx, 2), goodWhenUp: false },
  { key: "p95LatencyMs", label: "p95 latency", fmt: (s) => fmtMs(s.p95LatencyMs), goodWhenUp: false },
  { key: "avgLatencyMs", label: "Avg latency", fmt: (s) => fmtMs(s.avgLatencyMs), goodWhenUp: false },
];

export function KpiCards({ data, loading }: { data?: Summary; loading: boolean }) {
  // Carry the active filters / time-range into the drill-down so /anomalies
  // opens scoped exactly as the user has things here. useSearchParams() reflects
  // the nuqs-serialized filter state currently in the URL.
  const params = useSearchParams();
  const qs = params.toString();
  const suffix = qs ? `&${qs}` : "";

  // Flagged metrics indexed by key. Keyed by string because the local MetricKey
  // (keyof Omit<Summary, "delta">) is wider than the anomaly MetricKey union.
  const anomalyByKey = new Map<string, MetricAnomaly>(
    scoreMetricAnomaly(data).map((a) => [a.key, a] as const),
  );

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
      {METRICS.map((m) => {
        const anomaly = anomalyByKey.get(m.key);
        const flagged = anomaly?.anomalous === true;
        // A regression = the metric moved in its unhealthy direction (a drop
        // where higher is better, or a rise where lower is better).
        let regression = false;
        if (flagged && anomaly) {
          const badDirection = anomaly.goodWhenUp ? "down" : "up";
          regression = anomaly.direction === badDirection;
        }

        return (
          <Link
            key={m.key}
            href={`/anomalies?metric=${m.key}${suffix}`}
            aria-label={`${m.label}: open anomaly drill-down`}
            className="panel block cursor-pointer px-3.5 py-3 transition-colors hover:border-line-strong hover:bg-panel-2"
          >
            <div className="flex items-start justify-between gap-1.5">
              <div className="text-[11px] font-medium uppercase tracking-wide text-faint">
                {m.label}
              </div>
              {flagged && anomaly && (
                <span
                  title={anomaly.text}
                  aria-label={anomaly.text}
                  className={cn(
                    "mt-0.5 size-2 shrink-0 rounded-full",
                    regression ? "bg-danger" : "bg-success",
                  )}
                />
              )}
            </div>
            {loading || !data ? (
              <Skeleton className="mt-2 h-7 w-20" />
            ) : (
              <>
                <div className="mt-1 text-xl font-semibold tabular text-foreground">{m.fmt(data)}</div>
                <div className="mt-0.5">
                  <Delta value={data.delta?.[m.key]} goodWhenUp={m.goodWhenUp} />
                </div>
              </>
            )}
          </Link>
        );
      })}
    </div>
  );
}

export function SectionTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2 className={cn("text-sm font-semibold tracking-tight text-foreground", className)}>
      {children}
    </h2>
  );
}
