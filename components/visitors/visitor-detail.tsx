"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Filter as FilterIcon, Fingerprint, Network, ScrollText } from "lucide-react";

import type { VisitorDetail } from "@/lib/domain/types";
import {
  fmtBytes,
  fmtCompact,
  fmtDateTime,
  fmtInt,
  fmtMs,
  fmtPct,
  fmtRelative,
  flagEmoji,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeviceIcon } from "@/components/visitors/device-icon";
import { StatusBar } from "@/components/charts/status-bar";
import { TimeseriesChart } from "@/components/charts/timeseries-chart";
import { TopList, type TopItem } from "@/components/overview/top-list";

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-faint">{label}</div>
      <div className={cn("mt-0.5 text-sm font-semibold tabular", tone ?? "text-foreground")}>
        {value}
      </div>
    </div>
  );
}

export function VisitorDetailView({
  detail,
  onFilterToIp,
}: {
  detail: VisitorDetail;
  onFilterToIp: () => void;
}) {
  const router = useRouter();
  const v = detail.visitor;

  const pathItems: TopItem[] = detail.topPaths.map((r) => ({
    key: r.key,
    label: r.label,
    value: fmtCompact(r.requests),
    sub: r.errorRate > 0.001 ? fmtPct(r.errorRate, 0) + " err" : undefined,
    share: r.share,
    tone: r.errorRate > 0.05 ? "warning" : "accent",
  }));
  const popItems: TopItem[] = detail.pops.map((r) => ({
    key: r.key,
    label: r.label,
    value: fmtCompact(r.requests),
    share: r.share,
    tone: "info",
  }));
  const uaItems: TopItem[] = detail.userAgents.map((r) => ({
    key: r.key,
    label: r.label,
    value: fmtCompact(r.requests),
    share: r.share,
    tone: "accent",
  }));

  const sb = { s2: 0, s3: 0, s4: 0, s5: 0 };
  for (const s of detail.statusBreakdown) {
    if (s.key === "2xx") sb.s2 = s.requests;
    else if (s.key === "3xx") sb.s3 = s.requests;
    else if (s.key === "4xx") sb.s4 = s.requests;
    else if (s.key === "5xx") sb.s5 = s.requests;
  }

  const openInLogs = () => {
    // Carry the current (nuqs-encoded) filter and scope it to this IP.
    const sp = new URLSearchParams(window.location.search);
    sp.set("clientIp", v.clientIp);
    router.push("/logs?" + sp.toString());
  };

  return (
    <div className="space-y-4">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-xs text-faint hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Back
      </button>

      {/* Identity */}
      <div className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-xl border border-line bg-surface text-2xl">
              {flagEmoji(v.country)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-mono text-lg font-semibold text-foreground">{v.clientIp}</h1>
                <DeviceIcon type={v.deviceType} className="size-4 text-muted" />
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                <span>
                  {v.city ? `${v.city}, ` : ""}
                  {v.countryName}
                </span>
                <span className="flex items-center gap-1">
                  <Network className="size-3 text-faint" />
                  AS{v.asn} {v.asnOrg}
                </span>
                <span>{v.uaFamily}</span>
                <span className="flex items-center gap-1 font-mono text-faint">
                  <Fingerprint className="size-3" />
                  {v.ja4}
                </span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="subtle" onClick={onFilterToIp}>
              <FilterIcon className="size-3" />
              Filter to this IP
            </Button>
            <Button size="sm" variant="outline" onClick={openInLogs}>
              <ScrollText className="size-3" />
              View in logs
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Requests" value={fmtInt(v.requests)} />
          <Stat label="Distinct paths" value={fmtInt(v.distinctPaths)} tone="text-accent" />
          <Stat label="Data" value={fmtBytes(v.bytes)} />
          <Stat
            label="Error rate"
            value={fmtPct(v.errorRate, 1)}
            tone={v.errorRate > 0.05 ? "text-danger" : "text-foreground"}
          />
          <Stat label="First seen" value={fmtRelative(v.firstSeen)} />
          <Stat label="Last seen" value={fmtRelative(v.lastSeen)} />
        </div>
      </div>

      {/* Activity timeline */}
      <Card>
        <CardHeader>
          <CardTitle>Activity over time</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          <TimeseriesChart data={detail.timeline} />
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Paths visited</CardTitle>
          </CardHeader>
          <TopList items={pathItems} loading={false} rows={10} />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Edge PoPs</CardTitle>
          </CardHeader>
          <TopList items={popItems} loading={false} rows={10} />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Status & user agents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <StatusBar {...sb} className="h-2" />
            <div className="flex flex-wrap gap-1.5">
              {detail.statusBreakdown
                .slice()
                .sort((a, b) => b.requests - a.requests)
                .map((s) => (
                  <Badge
                    key={s.key}
                    variant={
                      s.key === "2xx"
                        ? "success"
                        : s.key === "3xx"
                          ? "info"
                          : s.key === "4xx"
                            ? "warning"
                            : s.key === "5xx"
                              ? "danger"
                              : "default"
                    }
                  >
                    {s.key} · {fmtInt(s.requests)}
                  </Badge>
                ))}
            </div>
            <div className="border-t border-line pt-1">
              <TopList items={uaItems} loading={false} rows={5} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent requests */}
      <Card>
        <CardHeader>
          <CardTitle>Recent requests</CardTitle>
          <span className="text-xs text-faint">latest {detail.recent.length}</span>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-line text-left text-[11px] uppercase tracking-wide text-faint">
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Method</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Path</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">PoP</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">Cache</th>
                <th className="px-3 py-2 text-right font-medium">Latency</th>
              </tr>
            </thead>
            <tbody>
              {detail.recent.map((r) => (
                <tr key={r.trackingRef} className="border-b border-line/50 hover:bg-panel-2/40">
                  <td className="whitespace-nowrap px-4 py-1.5 text-xs text-muted tabular">
                    {fmtDateTime(r.timestamp)}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs text-muted">{r.method}</td>
                  <td className="px-3 py-1.5">
                    <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                  </td>
                  <td className="max-w-[320px] truncate px-3 py-1.5 font-mono text-xs">
                    <span className="text-faint">{r.host}</span>
                    <span className="text-foreground">{r.path}</span>
                  </td>
                  <td className="hidden px-3 py-1.5 text-xs text-muted md:table-cell">{r.pop}</td>
                  <td className="hidden px-3 py-1.5 text-xs text-muted md:table-cell">{r.cacheStatus}</td>
                  <td className="px-3 py-1.5 text-right text-xs text-muted tabular">
                    {fmtMs(r.timeTaken * 1000)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
