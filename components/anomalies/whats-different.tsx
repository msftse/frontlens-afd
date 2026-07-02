"use client";

import { useMemo } from "react";
import { GitCompareArrows, Sparkles } from "lucide-react";

import type { Dimension } from "@/lib/domain/types";
import type { Filter } from "@/lib/filters/model";
import type { Incident } from "@/lib/anomaly";
import { computeLift, baselineWindowFor, type LiftRow } from "@/lib/lift";
import { partitionDimensions, toSourceKind } from "@/lib/datasource/capabilities";
import { useTopN } from "@/lib/api/hooks";
import { fmtCompact, fmtDateTime } from "@/lib/format";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

/** Dimensions worth diffing during an incident, per metric under investigation. */
const LIFT_DIMS: { dimension: Dimension; label: string }[] = [
  { dimension: "path", label: "Paths" },
  { dimension: "clientIp", label: "Client IPs" },
  { dimension: "country", label: "Countries" },
  { dimension: "status", label: "Status codes" },
  { dimension: "ja4", label: "TLS fingerprints (JA4)" },
  { dimension: "pop", label: "Edge POPs" },
  { dimension: "asnOrg", label: "Networks" },
  { dimension: "uaFamily", label: "User agents" },
];

/** Apply an explicit [from,to] custom window to a filter (leaves facets intact). */
function withWindow(base: Filter, from: string, to: string): Filter {
  return { ...base, from, to };
}

function liftBadge(row: LiftRow): { variant: "danger" | "warning" | "accent"; text: string } {
  if (row.isNew) return { variant: "danger", text: "new" };
  if (row.lift >= 4) return { variant: "danger", text: `${row.lift.toFixed(1)}x` };
  if (row.lift >= 2) return { variant: "warning", text: `${row.lift.toFixed(1)}x` };
  return { variant: "accent", text: `${row.lift.toFixed(1)}x` };
}

/**
 * "What's different during this incident" - lift analysis comparing the incident
 * window against the period just before it, across the real AFD dimensions. It
 * surfaces values that are over-represented during the incident (a spiking path,
 * a suspect IP, a new TLS fingerprint), the Radar-style "what changed". Gated by
 * source so it never diffs a fabricated dimension on Live.
 */
export function WhatsDifferent({
  incident,
  baseFilter,
  source,
  earliest,
}: {
  incident: Incident;
  baseFilter: Filter;
  source: string | null;
  /** Left edge of the loaded data, to clamp the baseline window. */
  earliest?: string;
}) {
  const kind = toSourceKind(source);
  const shown = useMemo(() => partitionDimensions(kind, LIFT_DIMS).supported, [kind]);

  const baseline = useMemo(
    () => baselineWindowFor(incident.startTime, incident.endTime, { earliest }),
    [incident.startTime, incident.endTime, earliest],
  );

  const incidentFilter = useMemo(
    () => withWindow(baseFilter, incident.startTime, incident.endTime),
    [baseFilter, incident.startTime, incident.endTime],
  );
  const baselineFilter = useMemo(
    () => (baseline ? withWindow(baseFilter, baseline.from, baseline.to) : null),
    [baseFilter, baseline],
  );

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-2">
          <GitCompareArrows className="size-4 text-accent" />
          What&apos;s different during this incident
        </CardTitle>
        {baseline && (
          <p className="text-xs text-faint">
            Incident {fmtDateTime(incident.startTime)} vs baseline{" "}
            {fmtDateTime(baseline.from)} – {fmtDateTime(baseline.to)}
          </p>
        )}
      </CardHeader>
      <div className="px-1.5 pb-2 pt-1">
        {!baselineFilter ? (
          <div className="px-3 py-8 text-center text-xs text-faint">
            Not enough history before this incident to compare.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((d) => (
              <LiftDimension
                key={d.dimension}
                dimension={d.dimension}
                label={d.label}
                incidentFilter={incidentFilter}
                baselineFilter={baselineFilter}
              />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function LiftDimension({
  dimension,
  label,
  incidentFilter,
  baselineFilter,
}: {
  dimension: Dimension;
  label: string;
  incidentFilter: Filter;
  baselineFilter: Filter;
}) {
  const inc = useTopN(incidentFilter, { dimension, sortBy: "requests", limit: 25 });
  const base = useTopN(baselineFilter, { dimension, sortBy: "requests", limit: 100 });

  const loading = inc.isLoading || base.isLoading;
  const rows = useMemo(() => {
    if (!inc.data || !base.data) return [];
    return computeLift(inc.data, base.data, { limit: 5 });
  }, [inc.data, base.data]);

  return (
    <div className="rounded-lg border border-line bg-surface px-2 py-2">
      <div className="mb-1 px-1 text-xs font-semibold text-muted">{label}</div>
      {loading ? (
        <div className="space-y-1.5 px-0.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="px-1 py-3 text-center text-[11px] text-faint">
          <Sparkles className="mx-auto mb-1 size-3 opacity-50" />
          Nothing over-represented
        </div>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((r) => {
            const b = liftBadge(r);
            return (
              <li key={r.key} className="flex items-center gap-2 px-1 py-0.5">
                <Badge variant={b.variant} className="shrink-0 tabular">
                  {b.text}
                </Badge>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" title={r.label}>
                  {r.label}
                </span>
                <span className="shrink-0 text-[11px] tabular text-faint">
                  {(r.incidentShare * 100).toFixed(0)}%
                  <span className="text-line"> / </span>
                  {(r.baselineShare * 100).toFixed(0)}%
                </span>
                <span className="shrink-0 text-[11px] tabular text-muted">
                  {fmtCompact(r.incidentRequests)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
