"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryState } from "nuqs";
import { Radar } from "lucide-react";

import { useFilters, type ExcludeKey, type FacetKey } from "@/lib/filters/use-filters";
import { useSummary, useTimeseries } from "@/lib/api/hooks";
import { useReportedDataSource } from "@/lib/api/source";
import {
  BREAKDOWNS,
  METRIC_CONFIG,
  detectIncidentsForMetrics,
  incidentZoomRange,
  scoreMetricAnomaly,
  worstAnomaly,
  type Incident,
  type MetricKey,
} from "@/lib/anomaly";
import {
  UNSUPPORTED_REASON,
  isWafSupported,
  partitionDimensions,
  toSourceKind,
} from "@/lib/datasource/capabilities";
import { decodeStatus, filterToSearchParams } from "@/lib/filters/model";
import type { Dimension } from "@/lib/domain/types";
import { PageHeader } from "@/components/ui/page-header";
import { MetricStrip } from "@/components/anomalies/metric-strip";
import { MetricTrend } from "@/components/anomalies/metric-trend";
import { MetricOverlay } from "@/components/anomalies/metric-overlay";
import { IncidentFeed } from "@/components/anomalies/incident-feed";
import { IncidentTimeline } from "@/components/anomalies/incident-timeline";
import { WhatsDifferent } from "@/components/anomalies/whats-different";
import { ProxyPanel } from "@/components/anomalies/proxy-panel";
import { AlertsPanel } from "@/components/anomalies/alerts-panel";
import { WafSection } from "@/components/anomalies/waf-section";
import {
  BreakdownPanel,
  mergeFilter,
  pinFilterValue,
  type BreakdownActions,
} from "@/components/anomalies/breakdown-panel";

type FiltersApi = ReturnType<typeof useFilters>;

const METRIC_KEYS = METRIC_CONFIG.map((c) => c.key);
function isMetricKey(s: string | null): s is MetricKey {
  return s !== null && (METRIC_KEYS as readonly string[]).includes(s);
}

// Dimension → filter-helper routing. Mirrors the FacetKey / ExcludeKey sets that
// `useFilters` exposes (deviceType is exclude-only via the helper, so its
// positive toggle goes through the raw setter).
const POSITIVE_FACETS: readonly FacetKey[] = [
  "host",
  "country",
  "city",
  "asnOrg",
  "clientIp",
  "cidr",
  "method",
  "uaFamily",
  "pop",
  "cacheStatus",
  "ja4",
  "referer",
];
const EXCLUDE_FACETS: readonly ExcludeKey[] = [
  "host",
  "country",
  "city",
  "asnOrg",
  "clientIp",
  "method",
  "uaFamily",
  "deviceType",
  "pop",
  "cacheStatus",
  "ja4",
  "referer",
];
const DEVICE_TYPES = ["desktop", "mobile", "tablet", "bot"] as const;
type DeviceTypeLit = (typeof DEVICE_TYPES)[number];

type FacetDim = FacetKey & Dimension;
function isFacetKey(d: Dimension): d is FacetDim {
  return (POSITIVE_FACETS as readonly string[]).includes(d);
}
function isExcludeKey(d: Dimension): d is ExcludeKey {
  return (EXCLUDE_FACETS as readonly string[]).includes(d);
}
function isDeviceType(s: string): s is DeviceTypeLit {
  return (DEVICE_TYPES as readonly string[]).includes(s);
}

/** Add a row's value as a positive filter facet (mirrors the breakdown dimension). */
function applyFilter(fh: FiltersApi, dim: Dimension, key: string) {
  if (dim === "path") {
    fh.addPath({ mode: "exact", value: key });
    return;
  }
  if (dim === "status") {
    const s = decodeStatus(key);
    if (s !== null) fh.toggleStatus(s);
    return;
  }
  if (dim === "deviceType") {
    if (!isDeviceType(key)) return;
    fh.setRaw((prev) => {
      const cur = prev.deviceType;
      return { deviceType: cur.includes(key) ? cur.filter((v) => v !== key) : [...cur, key] };
    });
    return;
  }
  if (isFacetKey(dim)) fh.toggle(dim, key);
}

/** Add a row's value as a negated ("Exclude") facet. */
function applyExclude(fh: FiltersApi, dim: Dimension, key: string) {
  if (dim === "path") {
    fh.addPath({ mode: "exact", value: key, negate: true });
    return;
  }
  if (dim === "status") {
    const s = decodeStatus(key);
    if (s !== null) fh.toggleExcludeStatus(s);
    return;
  }
  if (isExcludeKey(dim)) fh.toggleExclude(dim, key);
}

export default function AnomaliesPage() {
  const fh = useFilters();
  const router = useRouter();

  const summary = useSummary(fh.filter);
  const ts = useTimeseries(fh.filter);

  const anomalies = scoreMetricAnomaly(summary.data);
  const [metricParam, setMetric] = useQueryState("metric");

  // Stable reference so incident detection (and everything keyed off `points`)
  // only recomputes when the timeseries actually changes, not on every render
  // while the query is loading (`ts.data` is undefined then).
  const points = useMemo(() => ts.data ?? [], [ts.data]);
  const incidents = useMemo(
    () => detectIncidentsForMetrics(points, METRIC_KEYS),
    [points],
  );

  const selected: MetricKey = isMetricKey(metricParam)
    ? metricParam
    : (incidents[0]?.metric ?? worstAnomaly(anomalies) ?? "requests");

  const breakdown = BREAKDOWNS[selected];
  const prefilter = breakdown.prefilter;

  // Capability gating: on Live (Front Door access logs) some breakdown
  // dimensions have no real backing data (ASN, UA family, city). We hide those
  // rather than show fabricated values, and note what was hidden and why.
  const reportedSource = useReportedDataSource();
  const source = toSourceKind(reportedSource);
  const { supported: shownDims, hidden: hiddenDims } = useMemo(
    () => partitionDimensions(source, breakdown.dims),
    [source, breakdown.dims],
  );

  const windowStart = points[0]?.t;
  const windowEnd = points[points.length - 1]?.t;

  // The incident currently being investigated (drives the "what's different"
  // lift panel). Cleared when the user picks a different metric from the strip.
  const [activeIncident, setActiveIncident] = useState<Incident | null>(null);

  /** Select the incident's metric, zoom the range to its window, and diff it. */
  const investigate = (incident: Incident) => {
    setMetric(incident.metric);
    setActiveIncident(incident);
    const range = incidentZoomRange(points, incident.startIdx, incident.endIdx);
    if (range) fh.setCustomRange(range.from, range.to);
  };

  // The page owns all stateful wiring + routing; panels stay presentational and
  // call back through this typed `on` object. Open-in-* builds a transiently
  // scoped (prefilter + this row) filter and serializes it to the target view.
  const on: BreakdownActions = {
    filter: (dim, key) => applyFilter(fh, dim, key),
    exclude: (dim, key) => applyExclude(fh, dim, key),
    openInLogs: (dim, key) =>
      router.push(
        "/logs?" +
          filterToSearchParams(pinFilterValue(mergeFilter(fh.filter, prefilter), dim, key)).toString(),
      ),
    openInVisitors: (dim, key) =>
      router.push(
        "/visitors?" +
          filterToSearchParams(pinFilterValue(mergeFilter(fh.filter, prefilter), dim, key)).toString(),
      ),
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Anomalies"
        description="Spot which KPIs moved, see when the spike happened, then decompose what's driving it."
      />

      <MetricStrip
        anomalies={anomalies}
        selected={selected}
        onSelect={(k) => {
          setMetric(k);
          setActiveIncident(null);
        }}
      />

      <IncidentTimeline
        incidents={incidents}
        windowStart={windowStart}
        windowEnd={windowEnd}
        onInvestigate={investigate}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <MetricTrend
            metric={selected}
            points={points}
            onZoom={(from, to) => fh.setCustomRange(from, to)}
            loading={ts.isLoading}
          />
        </div>
        <IncidentFeed
          incidents={incidents}
          loading={ts.isLoading}
          selectedMetric={selected}
          onInvestigate={investigate}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <MetricOverlay points={points} loading={ts.isLoading} />
        </div>
        <ProxyPanel filter={fh.filter} />
      </div>

      <AlertsPanel incidents={incidents} />

      {activeIncident && (
        <WhatsDifferent
          incident={activeIncident}
          baseFilter={fh.filter}
          source={reportedSource}
          points={points}
        />
      )}

      <div className="flex items-center gap-2 pt-1">
        <Radar className="size-4 text-accent" />
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          What&apos;s driving it
        </h2>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shownDims.map((dim) => (
          <BreakdownPanel
            key={`${dim.dimension}:${dim.label}`}
            metric={selected}
            dim={dim}
            filter={fh.filter}
            prefilter={prefilter}
            on={on}
          />
        ))}
      </div>

      {hiddenDims.length > 0 && (
        <p className="text-xs text-faint">
          Not shown on this source:{" "}
          {hiddenDims.map((d, i) => (
            <span key={d.dimension}>
              {i > 0 && ", "}
              <span className="text-muted">{d.label}</span> (
              {UNSUPPORTED_REASON[d.dimension] ?? "unavailable"})
            </span>
          ))}
          .
        </p>
      )}

      {isWafSupported(source) && <WafSection filter={fh.filter} />}
    </div>
  );
}
