import type {
  Dimension,
  GeoRow,
  LogsPage,
  PathRow,
  Summary,
  TimePoint,
  TopNRow,
  VisitorDetail,
  VisitorRow,
} from "@/lib/domain/types";
import type {
  LogsOptions,
  PathExplorerOptions,
  TopNOptions,
  VisitorsOptions,
} from "@/lib/datasource/types";
import type { Filter } from "@/lib/filters/model";
import { getSelectedSource, reportDataSource } from "@/lib/api/source";

async function call<T>(
  resource: string,
  filter: Filter,
  options?: Record<string, unknown>,
): Promise<T> {
  const source = getSelectedSource();
  const res = await fetch("/api/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resource, filter, options, ...(source ? { source } : {}) }),
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const body = (await res.json()) as { data: T; source?: string };
  reportDataSource(body.source);
  return body.data;
}

export const api = {
  summary: (f: Filter) => call<Summary>("summary", f),
  timeseries: (f: Filter, bucketSeconds?: number) =>
    call<TimePoint[]>("timeseries", f, { bucketSeconds }),
  topN: (f: Filter, o: TopNOptions) => call<TopNRow[]>("topN", f, { ...o }),
  geo: (f: Filter) => call<GeoRow[]>("geo", f),
  paths: (f: Filter, o?: PathExplorerOptions) =>
    call<{ rows: PathRow[]; total: number }>("paths", f, { ...o }),
  pathVisitors: (f: Filter, host: string, path: string, o?: VisitorsOptions) =>
    call<{ rows: VisitorRow[]; total: number }>("pathVisitors", f, { host, path, ...o }),
  visitors: (f: Filter, o?: VisitorsOptions) =>
    call<{ rows: VisitorRow[]; total: number }>("visitors", f, { ...o }),
  visitorDetail: (f: Filter, clientIp: string) =>
    call<VisitorDetail | null>("visitorDetail", f, { clientIp }),
  logs: (f: Filter, o?: LogsOptions) => call<LogsPage>("logs", f, { ...o }),
  facetValues: (f: Filter, dimension: Dimension, limit?: number) =>
    call<TopNRow[]>("facetValues", f, { dimension, limit }),
};
