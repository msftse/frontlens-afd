"use client";

import { Network, ShieldCheck } from "lucide-react";

import type { Filter } from "@/lib/filters/model";
import { useProxyChains } from "@/lib/api/hooks";
import { fmtCompact, fmtInt, fmtPct } from "@/lib/format";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Proxy-chain detection: requests where the direct peer (SocketIp) differs from
 * the forwarded ClientIp (X-Forwarded-For), i.e. traffic arriving through a
 * proxy, corporate egress or forwarder. Both IPs are real Front Door access-log
 * fields, so this is genuine on Live; it simply shows nothing when no proxied
 * traffic is present (an honest empty state, not a fabricated one).
 */
export function ProxyPanel({ filter }: { filter: Filter }) {
  const q = useProxyChains(filter, 8);
  const data = q.data;
  const share = data && data.total ? data.proxied / data.total : 0;

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-2">
          <Network className="size-4 text-accent" />
          Proxy chains
          {data && data.proxied > 0 && (
            <Badge variant="warning" className="tabular">
              {fmtPct(share, 1)}
            </Badge>
          )}
        </CardTitle>
        <p className="text-xs text-faint">
          Requests whose SocketIp differs from the forwarded ClientIp.
        </p>
      </CardHeader>
      <div className="px-1.5 pb-2 pt-1">
        {q.isLoading ? (
          <div className="space-y-1.5 px-0.5 py-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : !data || data.proxied === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-faint">
            <ShieldCheck className="mx-auto mb-1 size-4 opacity-50" />
            No proxied traffic in this window.
            <div className="mt-0.5 text-[11px]">
              All requests reached the edge directly ({fmtCompact(data?.total ?? 0)} considered).
            </div>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {data.pairs.map((p) => (
              <li
                key={p.clientIp}
                className="flex items-center gap-2 rounded-md px-2 py-1.5"
                title={`${p.clientIp} via ${p.socketIp}`}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                  {p.clientIp}
                  <span className="text-faint"> via </span>
                  <span className="text-muted">{p.socketIp}</span>
                </span>
                {p.distinctSockets > 1 && (
                  <Badge variant="outline" className="shrink-0 tabular">
                    {p.distinctSockets} peers
                  </Badge>
                )}
                <span className="shrink-0 text-xs font-medium tabular text-foreground">
                  {fmtInt(p.requests)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
