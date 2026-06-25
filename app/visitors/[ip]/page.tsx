"use client";

import { useParams } from "next/navigation";

import { useFilters } from "@/lib/filters/use-filters";
import { useVisitorDetail } from "@/lib/api/hooks";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ComingSoon } from "@/components/ui/coming-soon";
import { VisitorDetailView } from "@/components/visitors/visitor-detail";

export default function VisitorDetailPage() {
  const params = useParams<{ ip: string }>();
  const ip = decodeURIComponent(params.ip);
  const fh = useFilters();
  const { data, isLoading } = useVisitorDetail(fh.filter, ip);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title={ip} description="Visitor activity" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <ComingSoon
        title="No activity"
        note={`No requests from ${ip} in the selected time window. Try widening the time range or clearing filters.`}
      />
    );
  }

  return (
    <VisitorDetailView
      detail={data}
      onFilterToIp={() => fh.toggle("clientIp", ip)}
    />
  );
}
