"use client";

import { AlertTriangle, ArrowDownRight, ArrowUpRight, Search } from "lucide-react";

import type { Incident, MetricKey } from "@/lib/anomaly";
import { fmtCompact, fmtDateTime, fmtMs, fmtPct, fmtRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function isRate(m: MetricKey): boolean {
  return m === "cacheHitRatio" || m === "errorRate4xx" || m === "errorRate5xx";
}
function isLatency(m: MetricKey): boolean {
  return m === "p95LatencyMs" || m === "avgLatencyMs";
}

/** Format a metric value in its own unit (rate / latency / count). */
function fmtMetric(m: MetricKey, v: number): string {
  if (isRate(m)) return fmtPct(v, 2);
  if (isLatency(m)) return fmtMs(v);
  return fmtCompact(v);
}

/** "3m", "1h 5m", "45s" for a duration between two ISO bucket edges (inclusive). */
function fmtDuration(startIso: string, endIso: string, buckets: number): string {
  const ms = Math.max(0, Date.parse(endIso) - Date.parse(startIso));
  // A single-bucket incident has start==end; show it as "1 bucket" rather than 0.
  if (ms === 0) return buckets <= 1 ? "1 bucket" : `${buckets} buckets`;
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

/** Severity → badge treatment. */
function severityBadge(sev: number): { variant: "danger" | "warning" | "info"; text: string } {
  if (sev >= 0.66) return { variant: "danger", text: "High" };
  if (sev >= 0.33) return { variant: "warning", text: "Medium" };
  return { variant: "info", text: "Low" };
}

/**
 * Ranked incident feed for the analysis window. Each row is a discrete event
 * detected by the incident engine (rolling baseline + grouping), showing the
 * metric, when it happened, how far it moved from normal, and an Investigate
 * action that selects the metric and zooms the range to the incident.
 *
 * Presentational: the page owns detection and wiring.
 */
export function IncidentFeed({
  incidents,
  loading,
  selectedMetric,
  onInvestigate,
}: {
  incidents: Incident[];
  loading?: boolean;
  selectedMetric?: MetricKey;
  onInvestigate: (incident: Incident) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-warning" />
          Incidents
          {!loading && incidents.length > 0 && (
            <Badge variant="outline">{incidents.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        {loading ? (
          <div className="space-y-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : incidents.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-faint">
            No incidents detected in this window. Traffic is within its normal range.
          </div>
        ) : (
          <ul className="space-y-1">
            {incidents.map((inc) => (
              <IncidentRow
                key={`${inc.metric}:${inc.startTime}:${inc.endTime}`}
                incident={inc}
                active={selectedMetric === inc.metric}
                onInvestigate={() => onInvestigate(inc)}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function IncidentRow({
  incident,
  active,
  onInvestigate,
}: {
  incident: Incident;
  active: boolean;
  onInvestigate: () => void;
}) {
  const sev = severityBadge(incident.severity);
  const DirIcon = incident.direction === "up" ? ArrowUpRight : ArrowDownRight;
  const dirClass = incident.direction === "up" ? "text-danger" : "text-info";

  return (
    <li
      className={cn(
        "group flex items-center gap-3 rounded-md border border-transparent px-2 py-2 transition-colors hover:bg-panel-2",
        active && "border-line bg-panel-2",
      )}
    >
      <Badge variant={sev.variant} className="shrink-0">
        {sev.text}
      </Badge>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <DirIcon className={cn("size-3.5 shrink-0", dirClass)} />
          <span className="truncate">{incident.label}</span>
          <span className="text-faint">·</span>
          <span className="tabular text-muted">
            {fmtMetric(incident.metric, incident.peakValue)}
          </span>
          <span className="text-faint">vs</span>
          <span className="tabular text-faint">
            {fmtMetric(incident.metric, incident.baselineAtPeak)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-faint">
          <span title={fmtDateTime(incident.startTime)}>{fmtRelative(incident.startTime)}</span>
          <span>·</span>
          <span>{fmtDuration(incident.startTime, incident.endTime, incident.buckets)}</span>
          <span>·</span>
          <span>{incident.peakScore.toFixed(1)}σ from normal</span>
        </div>
      </div>
      <Button
        size="sm"
        variant="subtle"
        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={onInvestigate}
      >
        <Search className="size-3" />
        Investigate
      </Button>
    </li>
  );
}
