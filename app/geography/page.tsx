"use client";

import { useState } from "react";
import { Building2, Globe2, MapPin } from "lucide-react";

import { useFilters } from "@/lib/filters/use-filters";
import { useGeo, useTopN } from "@/lib/api/hooks";
import { fmtCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { WorldMap, type GeoMetric } from "@/components/charts/world-map";
import { CountryTable } from "@/components/geography/country-table";
import { TopList, type TopItem } from "@/components/overview/top-list";

const METRICS: { key: GeoMetric; label: string }[] = [
  { key: "requests", label: "Requests" },
  { key: "uniqueVisitors", label: "Visitors" },
  { key: "bytes", label: "Data" },
];

export default function GeographyPage() {
  const fh = useFilters();
  const { filter } = fh;
  const [metric, setMetric] = useState<GeoMetric>("requests");

  const geo = useGeo(filter);
  const cities = useTopN(filter, { dimension: "city", limit: 10 });
  const networks = useTopN(filter, { dimension: "asnOrg", limit: 10 });

  const cityItems: TopItem[] = (cities.data ?? []).map((r) => ({
    key: r.key,
    label: r.label,
    value: fmtCompact(r.requests),
    sub: `${fmtCompact(r.uniqueVisitors)} ip`,
    share: r.share,
    tone: "info",
  }));
  const netItems: TopItem[] = (networks.data ?? []).map((r) => ({
    key: r.key,
    label: r.label,
    value: fmtCompact(r.requests),
    sub: `${fmtCompact(r.uniqueVisitors)} ip`,
    share: r.share,
    tone: "accent",
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Geography"
        description="Where your traffic comes from, by country, city and network. Click anywhere to filter."
        actions={
          <div className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5">
            {METRICS.map((m) => (
              <button
                key={m.key}
                onClick={() => setMetric(m.key)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  metric === m.key
                    ? "bg-accent text-accent-foreground"
                    : "text-muted hover:text-foreground",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe2 className="size-4 text-accent" />
              Traffic by location
            </CardTitle>
          </CardHeader>
          <WorldMap
            data={geo.data ?? []}
            metric={metric}
            onSelect={(iso2) => fh.toggle("country", iso2)}
          />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Countries</CardTitle>
            <span className="text-xs text-faint">{(geo.data ?? []).length} total</span>
          </CardHeader>
          <CountryTable
            rows={geo.data ?? []}
            loading={geo.isLoading}
            metric={metric}
            selected={filter.country}
            onSelect={(iso2) => fh.toggle("country", iso2)}
          />
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="size-4 text-info" />
              Top cities
            </CardTitle>
          </CardHeader>
          <TopList
            items={cityItems}
            loading={cities.isLoading}
            rows={10}
            onSelect={(key) => fh.toggle("city", key)}
          />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-4 text-accent" />
              Top networks (ASN)
            </CardTitle>
          </CardHeader>
          <TopList
            items={netItems}
            loading={networks.isLoading}
            rows={10}
            onSelect={(key) => fh.toggle("asnOrg", key)}
          />
        </Card>
      </div>
    </div>
  );
}
