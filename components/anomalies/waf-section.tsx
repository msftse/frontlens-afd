"use client";

import { useMemo } from "react";
import { Shield, ShieldAlert, ShieldBan } from "lucide-react";

import type { Filter } from "@/lib/filters/model";
import type { WafAction, WafTopRow } from "@/lib/domain/types";
import { useWafSummary, useWafTimeseries, useWafTopN, useWafEvents } from "@/lib/api/hooks";
import { fmtCompact, fmtDateTime, fmtInt, fmtPct, fmtRelative } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Delta } from "@/components/ui/delta";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { WafTrend } from "@/components/anomalies/waf-trend";

function actionVariant(a: WafAction): "danger" | "warning" | "info" | "default" {
  if (a === "Block") return "danger";
  if (a === "AnomalyScoring") return "warning";
  if (a === "Log") return "info";
  return "default";
}

/**
 * WAF investigation section for the Anomalies page. Backed by Front Door's
 * FrontDoorWebApplicationFirewallLog (real on Live and mock; hidden on sources
 * without WAF). Surfaces block-rate over time with incident detection, top
 * firing rules and blocked client IPs, and a recent-events feed - the security
 * counterpart to the traffic anomaly view.
 */
export function WafSection({ filter }: { filter: Filter }) {
  const summary = useWafSummary(filter);
  const ts = useWafTimeseries(filter);
  const topRules = useWafTopN(filter, { dimension: "ruleName", limit: 6 });
  const topIps = useWafTopN(filter, { dimension: "clientIp", action: "Block", limit: 6 });
  const events = useWafEvents(filter, { limit: 8 });

  const points = ts.data ?? [];
  const s = summary.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 pt-1">
        <Shield className="size-4 text-accent" />
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          Web Application Firewall
        </h2>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <WafStat
          label="WAF events"
          value={s ? fmtCompact(s.total) : undefined}
          delta={s?.delta?.total}
          icon={<Shield className="size-4 text-muted" />}
        />
        <WafStat
          label="Blocked"
          value={s ? fmtCompact(s.blocked) : undefined}
          delta={s?.delta?.blocked}
          tone="danger"
          icon={<ShieldBan className="size-4 text-danger" />}
        />
        <WafStat
          label="Block rate"
          value={s ? fmtPct(s.blockRate, 1) : undefined}
          delta={s?.delta?.blockRate}
          icon={<ShieldAlert className="size-4 text-warning" />}
        />
        <WafStat
          label="Rules fired"
          value={s ? fmtInt(s.distinctRules) : undefined}
          sub={s ? `${fmtInt(s.distinctIps)} IPs` : undefined}
          icon={<Shield className="size-4 text-muted" />}
        />
      </div>

      {/* Block-rate trend + incidents */}
      <WafTrend points={points} loading={ts.isLoading} />

      {/* Top rules + blocked IPs */}
      <div className="grid gap-3 md:grid-cols-2">
        <WafTopCard
          title="Top rules"
          rows={topRules.data}
          loading={topRules.isLoading}
          showBlocked
        />
        <WafTopCard title="Most-blocked IPs" rows={topIps.data} loading={topIps.isLoading} mono />
      </div>

      {/* Recent events */}
      <Card>
        <CardHeader className="pb-1">
          <CardTitle>Recent WAF events</CardTitle>
        </CardHeader>
        <CardContent className="pt-1">
          {events.isLoading ? (
            <div className="space-y-1.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : (events.data?.rows.length ?? 0) === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-faint">
              No WAF events in this window.
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {events.data!.rows.map((e, i) => (
                <li key={`${e.trackingRef}:${i}`} className="flex items-center gap-2 py-1.5 text-xs">
                  <Badge variant={actionVariant(e.action)} className="shrink-0">
                    {e.action}
                  </Badge>
                  <span className="shrink-0 font-mono text-muted">{e.clientIp}</span>
                  <span className="min-w-0 flex-1 truncate text-foreground" title={e.message}>
                    {e.message || e.ruleName}
                  </span>
                  <span
                    className="hidden max-w-[30%] shrink truncate font-mono text-faint sm:block"
                    title={e.url}
                  >
                    {e.method} {e.url.replace(/^https?:\/\/[^/]+/i, "")}
                  </span>
                  <span
                    className="shrink-0 text-faint"
                    title={fmtDateTime(e.timestamp)}
                  >
                    {fmtRelative(e.timestamp)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function WafStat({
  label,
  value,
  sub,
  delta,
  tone,
  icon,
}: {
  label: string;
  value?: string;
  sub?: string;
  delta?: number;
  tone?: "danger";
  icon?: React.ReactNode;
}) {
  return (
    <Card className="px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-faint">{label}</span>
        {icon}
      </div>
      {value === undefined ? (
        <Skeleton className="mt-1 h-6 w-16" />
      ) : (
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className={cn("text-xl font-semibold tabular", tone === "danger" && "text-danger")}>
            {value}
          </span>
          {delta !== undefined && <Delta value={delta} goodWhenUp={false} />}
        </div>
      )}
      {sub && <div className="text-[11px] text-faint">{sub}</div>}
    </Card>
  );
}

function WafTopCard({
  title,
  rows,
  loading,
  showBlocked,
  mono,
}: {
  title: string;
  rows?: WafTopRow[];
  loading: boolean;
  showBlocked?: boolean;
  mono?: boolean;
}) {
  const max = useMemo(() => (rows && rows.length ? rows[0].count : 0), [rows]);
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-1">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <div className="px-1.5 pb-2 pt-1">
        {loading ? (
          <div className="space-y-1.5 px-0.5 py-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : (rows?.length ?? 0) === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-faint">No data</div>
        ) : (
          rows!.map((r) => (
            <div
              key={r.key}
              className="group relative flex items-center gap-2 overflow-hidden rounded-md px-2 py-1.5"
              title={r.label}
            >
              <span
                className="absolute inset-y-0 left-0 rounded-md bg-danger/15"
                style={{ width: `${max ? Math.max(2, (r.count / max) * 100) : 2}%` }}
              />
              <span
                className={cn(
                  "relative z-10 min-w-0 flex-1 truncate text-xs text-foreground",
                  mono && "font-mono",
                )}
              >
                {r.label}
              </span>
              {showBlocked && r.blocked > 0 && (
                <Badge variant="danger" className="relative z-10 shrink-0 tabular">
                  {fmtCompact(r.blocked)} blk
                </Badge>
              )}
              <span className="relative z-10 shrink-0 text-xs font-medium tabular text-foreground">
                {fmtCompact(r.count)}
              </span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
