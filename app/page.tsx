"use client";

import { useRouter } from "next/navigation";
import { Activity } from "lucide-react";

import { useFilters } from "@/lib/filters/use-filters";
import { useGeo, useSummary, useTimeseries, useTopN, useVisitors } from "@/lib/api/hooks";
import { fmtCompact, fmtInt, fmtPct, flagEmoji } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCards } from "@/components/overview/kpi-cards";
import { TimeseriesChart } from "@/components/charts/timeseries-chart";
import { TopList, type TopItem } from "@/components/overview/top-list";

export default function OverviewPage() {
  const fh = useFilters();
  const { filter } = fh;
  const router = useRouter();

  const summary = useSummary(filter);
  const ts = useTimeseries(filter);
  const paths = useTopN(filter, { dimension: "path", limit: 8 });
  const geo = useGeo(filter);
  const visitors = useVisitors(filter, { limit: 8 });

  const totalReq = summary.data?.requests ?? 0;

  const pathItems: TopItem[] = (paths.data ?? []).map((r) => ({
    key: r.key,
    label: r.label,
    value: fmtCompact(r.requests),
    sub: r.errorRate > 0.001 ? fmtPct(r.errorRate, 1) + " err" : undefined,
    share: r.share,
    tone: r.errorRate > 0.05 ? "warning" : "accent",
  }));

  const countryItems: TopItem[] = (geo.data ?? []).slice(0, 8).map((r) => ({
    key: r.country,
    label: (
      <span>
        <span className="mr-1.5">{flagEmoji(r.country)}</span>
        {r.countryName}
      </span>
    ),
    value: fmtCompact(r.requests),
    sub: `${fmtCompact(r.uniqueVisitors)} ip`,
    share: r.share,
    tone: "info",
  }));

  const visitorItems: TopItem[] = (visitors.data?.rows ?? []).map((v) => ({
    key: v.clientIp,
    label: (
      <span className="flex items-center gap-1.5">
        <span>{flagEmoji(v.country)}</span>
        <span className="font-mono">{v.clientIp}</span>
        <span className="truncate text-faint">· {v.asnOrg}</span>
      </span>
    ),
    value: fmtCompact(v.requests),
    sub: `${v.distinctPaths}p`,
    share: totalReq ? v.requests / totalReq : 0,
    tone: v.errorRate > 0.1 ? "danger" : "accent",
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Overview"
        description="Traffic, security and performance across your Front Door profile."
      />

      <KpiCards data={summary.data} loading={summary.isLoading} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="size-4 text-accent" />
            Requests over time
          </CardTitle>
          <span className="text-xs text-faint tabular">{fmtInt(totalReq)} total</span>
        </CardHeader>
        <CardContent className="pt-2">
          <TimeseriesChart data={ts.data ?? []} />
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Top paths</CardTitle>
            <button
              onClick={() => router.push("/paths" + window.location.search)}
              className="text-xs text-faint hover:text-accent"
            >
              Explore →
            </button>
          </CardHeader>
          <TopList
            items={pathItems}
            loading={paths.isLoading}
            onSelect={(key) => fh.addPath({ mode: "exact", value: key })}
          />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top countries</CardTitle>
            <button
              onClick={() => router.push("/geography" + window.location.search)}
              className="text-xs text-faint hover:text-accent"
            >
              Map →
            </button>
          </CardHeader>
          <TopList
            items={countryItems}
            loading={geo.isLoading}
            onSelect={(key) => fh.toggle("country", key)}
          />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top visitors</CardTitle>
            <button
              onClick={() => router.push("/visitors" + window.location.search)}
              className="text-xs text-faint hover:text-accent"
            >
              All →
            </button>
          </CardHeader>
          <TopList
            items={visitorItems}
            loading={visitors.isLoading}
            onSelect={(key) => router.push(`/visitors/${encodeURIComponent(key)}`)}
          />
        </Card>
      </div>
    </div>
  );
}
