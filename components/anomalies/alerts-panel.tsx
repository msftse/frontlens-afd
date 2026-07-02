"use client";

import { BellRing, Cloud } from "lucide-react";

import type { Incident } from "@/lib/anomaly";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function sevVariant(sev: number): "danger" | "warning" | "info" {
  if (sev >= 0.66) return "danger";
  if (sev >= 0.33) return "warning";
  return "info";
}

/**
 * Alerting panel. Two clearly-separated modes so nothing is misrepresented:
 *
 *  - In-session: the incidents the client detected in the loaded window. These
 *    exist only in this browser tab - a live "what would alert" list, not a
 *    delivered notification.
 *  - Azure Monitor: persistent, delivered alerts are provisioned as native
 *    scheduled-query rules in infra/alerts.bicep (email/webhook via an Action
 *    Group) over the same workspace. This panel documents them; it does not
 *    fake their delivery.
 */
export function AlertsPanel({ incidents }: { incidents: Incident[] }) {
  const top = incidents.slice(0, 5);

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-2">
          <BellRing className="size-4 text-accent" />
          Alerts
          <Badge variant="outline">in-session</Badge>
        </CardTitle>
        <p className="text-xs text-faint">
          Detected in this browser session. Persistent email/webhook alerts are provisioned as Azure
          Monitor rules (see below).
        </p>
      </CardHeader>
      <CardContent className="pt-1">
        {top.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-faint">
            Nothing to alert on in this window.
          </div>
        ) : (
          <ul className="space-y-1">
            {top.map((inc) => (
              <li
                key={`${inc.metric}:${inc.startTime}`}
                className="flex items-center gap-2 rounded-md border border-line px-2 py-1.5 text-xs"
              >
                <Badge variant={sevVariant(inc.severity)} className="shrink-0">
                  {inc.severity >= 0.66 ? "High" : inc.severity >= 0.33 ? "Medium" : "Low"}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {inc.label} {inc.direction === "up" ? "rose" : "dropped"} ({inc.peakScore.toFixed(1)}σ)
                </span>
                <span className="shrink-0 text-faint" title={fmtDateTime(inc.startTime)}>
                  {fmtRelative(inc.startTime)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex items-start gap-2 rounded-md bg-panel-2 px-2.5 py-2">
          <Cloud className="mt-0.5 size-3.5 shrink-0 text-info" />
          <div className="text-[11px] leading-relaxed text-muted">
            <span className="font-medium text-foreground">Delivered alerts</span> run as Azure Monitor
            scheduled-query rules over the Front Door workspace (5xx rate, p95 latency, WAF block
            surge) and notify email/webhook via an Action Group. Deploy them with{" "}
            <code className="rounded bg-surface px-1 py-0.5 font-mono text-foreground">
              az deployment group create -f infra/alerts.bicep
            </code>
            .
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
