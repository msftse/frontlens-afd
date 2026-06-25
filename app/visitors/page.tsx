"use client";

import { useState } from "react";
import { Users } from "lucide-react";

import { useFilters } from "@/lib/filters/use-filters";
import { useVisitors } from "@/lib/api/hooks";
import type { VisitorsOptions } from "@/lib/datasource/types";
import { fmtInt } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { VisitorList } from "@/components/visitors/visitor-list";

const SORTS: { key: NonNullable<VisitorsOptions["sortBy"]>; label: string }[] = [
  { key: "requests", label: "Requests" },
  { key: "bytes", label: "Data" },
  { key: "distinctPaths", label: "Distinct paths" },
  { key: "errorRate", label: "Error rate" },
  { key: "lastSeen", label: "Last seen" },
];

export default function VisitorsPage() {
  const { filter } = useFilters();
  const [sortBy, setSortBy] = useState<NonNullable<VisitorsOptions["sortBy"]>>("requests");
  const [limit, setLimit] = useState(100);

  const { data, isLoading } = useVisitors(filter, { sortBy, sortDir: "desc", limit });
  const total = data?.total ?? 0;
  const rows = data?.rows ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Visitors"
        description="Every client IP, enriched with country, city, network (ASN), device and TLS fingerprint."
        actions={
          <div className="flex items-center gap-2 text-xs text-muted">
            Sort by
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as NonNullable<VisitorsOptions["sortBy"]>)}
              className="h-8 cursor-pointer rounded-lg border border-line bg-surface px-2 text-xs text-foreground outline-none"
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        }
      />

      <div className="panel">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-xs text-faint">
          <span className="flex items-center gap-1.5">
            <Users className="size-3.5 text-accent" />
            <span className="font-semibold tabular text-foreground">{fmtInt(total)}</span> unique
            visitors
          </span>
          <span>Click any visitor to see everything they did</span>
        </div>
        <VisitorList rows={rows} loading={isLoading} />
        {!isLoading && rows.length < total && (
          <div className="border-t border-line p-3 text-center">
            <Button variant="subtle" size="sm" onClick={() => setLimit((l) => l + 100)}>
              Load more ({fmtInt(total - rows.length)} remaining)
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
