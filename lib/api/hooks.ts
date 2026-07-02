"use client";

import { useInfiniteQuery, useQuery, keepPreviousData } from "@tanstack/react-query";

import type { Dimension } from "@/lib/domain/types";
import type {
  LogsOptions,
  PathExplorerOptions,
  TopNOptions,
  VisitorsOptions,
} from "@/lib/datasource/types";
import type { Filter } from "@/lib/filters/model";
import { api } from "@/lib/api/client";
import { useSelectedSource } from "@/lib/api/source";

const common = { placeholderData: keepPreviousData, staleTime: 30_000 } as const;

export function useSummary(f: Filter) {
  const src = useSelectedSource();
  return useQuery({ queryKey: ["summary", src, f], queryFn: () => api.summary(f), ...common });
}

export function useTimeseries(f: Filter, bucketSeconds?: number) {
  const src = useSelectedSource();
  return useQuery({
    queryKey: ["timeseries", src, f, bucketSeconds],
    queryFn: () => api.timeseries(f, bucketSeconds),
    ...common,
  });
}

export function useTopN(f: Filter, opts: TopNOptions) {
  const src = useSelectedSource();
  return useQuery({
    queryKey: ["topN", src, f, opts],
    queryFn: () => api.topN(f, opts),
    ...common,
  });
}

export function useGeo(f: Filter) {
  const src = useSelectedSource();
  return useQuery({ queryKey: ["geo", src, f], queryFn: () => api.geo(f), ...common });
}

export function usePaths(f: Filter, opts?: PathExplorerOptions) {
  const src = useSelectedSource();
  return useQuery({
    queryKey: ["paths", src, f, opts],
    queryFn: () => api.paths(f, opts),
    ...common,
  });
}

export function usePathVisitors(
  f: Filter,
  host: string,
  path: string,
  opts?: VisitorsOptions,
  enabled = true,
) {
  const src = useSelectedSource();
  return useQuery({
    queryKey: ["pathVisitors", src, f, host, path, opts],
    queryFn: () => api.pathVisitors(f, host, path, opts),
    enabled: enabled && !!host && !!path,
    ...common,
  });
}

export function useVisitors(f: Filter, opts?: VisitorsOptions) {
  const src = useSelectedSource();
  return useQuery({
    queryKey: ["visitors", src, f, opts],
    queryFn: () => api.visitors(f, opts),
    ...common,
  });
}

export function useVisitorDetail(f: Filter, clientIp: string | null) {
  const src = useSelectedSource();
  return useQuery({
    queryKey: ["visitorDetail", src, f, clientIp],
    queryFn: () => api.visitorDetail(f, clientIp as string),
    enabled: !!clientIp,
    ...common,
  });
}

export function useLogs(f: Filter, opts?: LogsOptions) {
  const src = useSelectedSource();
  return useQuery({
    queryKey: ["logs", src, f, opts],
    queryFn: () => api.logs(f, opts),
    ...common,
  });
}

export function useInfiniteLogs(f: Filter, sortDir: "asc" | "desc" = "desc", limit = 100) {
  const src = useSelectedSource();
  return useInfiniteQuery({
    queryKey: ["logs-infinite", src, f, sortDir, limit],
    queryFn: ({ pageParam }) => api.logs(f, { cursor: pageParam, sortDir, limit }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useFacetValues(f: Filter, dimension: Dimension, limit?: number, enabled = true) {
  const src = useSelectedSource();
  return useQuery({
    queryKey: ["facets", src, f, dimension, limit],
    queryFn: () => api.facetValues(f, dimension, limit),
    enabled,
    ...common,
  });
}

export function useProxyChains(f: Filter, limit?: number, enabled = true) {
  const src = useSelectedSource();
  return useQuery({
    queryKey: ["proxyChains", src, f, limit],
    queryFn: () => api.proxyChains(f, limit),
    enabled,
    ...common,
  });
}
