import type {
  AccessLogRecord,
  Dimension,
  GeoRow,
  LogsPage,
  PathRow,
  ProxyChains,
  StatusClass,
  Summary,
  TimePoint,
  TopNRow,
  VisitorDetail,
  VisitorRow,
} from "@/lib/domain/types";
import { statusClass } from "@/lib/domain/types";
import type {
  DataSource,
  LogsOptions,
  PathExplorerOptions,
  TimeseriesOptions,
  TopNOptions,
  VisitorsOptions,
} from "@/lib/datasource/types";
import { resolveTimeRange, type Filter } from "@/lib/filters/model";
import { buildMatchContext, matchesFilter } from "@/lib/filters/match";
import { generateDataset, type MockDataset } from "@/lib/datasource/mock/generate";

// Persist the generated dataset across HMR reloads in dev.
const g = globalThis as unknown as { __afdMock?: MockDataset };
function dataset(): MockDataset {
  if (!g.__afdMock) {
    g.__afdMock = generateDataset({
      records: process.env.MOCK_RECORDS ? Number(process.env.MOCK_RECORDS) : undefined,
      visitors: process.env.MOCK_VISITORS ? Number(process.env.MOCK_VISITORS) : undefined,
    });
  }
  return g.__afdMock;
}

function isCacheHit(s: string): boolean {
  return s === "HIT" || s === "REMOTE_HIT" || s === "PARTIAL_HIT";
}
function isCacheConsidered(s: string): boolean {
  return isCacheHit(s) || s === "MISS";
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * sortedAsc.length));
  return sortedAsc[idx];
}

function filterRecords(f: Filter): { rows: AccessLogRecord[]; from: Date; to: Date } {
  const { from, to } = resolveTimeRange(f);
  const ctx = buildMatchContext(f, from, to);
  const all = dataset().records;
  const rows: AccessLogRecord[] = [];
  for (let i = 0; i < all.length; i++) {
    if (matchesFilter(all[i], f, ctx)) rows.push(all[i]);
  }
  return { rows, from, to };
}

function autoBucketSeconds(spanSeconds: number, targetPoints = 150): number {
  const nice = [60, 300, 900, 1800, 3600, 10800, 21600, 43200, 86400, 604800];
  const ideal = spanSeconds / targetPoints;
  for (const b of nice) if (b >= ideal) return b;
  return nice[nice.length - 1];
}

function dimValue(r: AccessLogRecord, d: Dimension): { key: string; label: string } {
  switch (d) {
    case "country":
      return { key: r.country, label: r.countryName };
    case "city":
      return { key: r.city, label: `${r.city}, ${r.country}` };
    case "asnOrg":
      return { key: r.asnOrg, label: r.asnOrg };
    case "clientIp":
      return { key: r.clientIp, label: r.clientIp };
    case "host":
      return { key: r.host, label: r.host };
    case "path":
      return { key: `${r.host}${r.path}`, label: `${r.host}${r.path}` };
    case "status":
      return { key: String(r.status), label: String(r.status) };
    case "statusClass":
      return { key: statusClass(r.status), label: statusClass(r.status) };
    case "method":
      return { key: r.method, label: r.method };
    case "uaFamily":
      return { key: r.uaFamily, label: r.uaFamily };
    case "deviceType":
      return { key: r.deviceType, label: r.deviceType };
    case "pop":
      return { key: r.pop, label: r.pop };
    case "cacheStatus":
      return { key: r.cacheStatus, label: r.cacheStatus };
    case "referer":
      return { key: r.referer || "(none)", label: r.referer || "(direct)" };
    case "ja4":
      return { key: r.ja4, label: r.ja4 };
    case "errorInfo":
      return { key: r.errorInfo, label: r.errorInfo };
  }
}

interface GroupAcc {
  key: string;
  label: string;
  requests: number;
  bytes: number;
  err: number;
  cacheHit: number;
  cacheConsidered: number;
  visitors: Set<string>;
  latencySum: number;
  s2: number;
  s3: number;
  s4: number;
  s5: number;
  lastSeen: number;
  firstSeen: number;
}

function newAcc(key: string, label: string): GroupAcc {
  return {
    key,
    label,
    requests: 0,
    bytes: 0,
    err: 0,
    cacheHit: 0,
    cacheConsidered: 0,
    visitors: new Set(),
    latencySum: 0,
    s2: 0,
    s3: 0,
    s4: 0,
    s5: 0,
    lastSeen: 0,
    firstSeen: Number.MAX_SAFE_INTEGER,
  };
}

function accumulate(acc: GroupAcc, r: AccessLogRecord) {
  acc.requests++;
  acc.bytes += r.responseBytes;
  const cls = statusClass(r.status);
  if (cls === "2xx") acc.s2++;
  else if (cls === "3xx") acc.s3++;
  else if (cls === "4xx") {
    acc.s4++;
    acc.err++;
  } else if (cls === "5xx") {
    acc.s5++;
    acc.err++;
  }
  if (isCacheHit(r.cacheStatus)) acc.cacheHit++;
  if (isCacheConsidered(r.cacheStatus)) acc.cacheConsidered++;
  acc.visitors.add(r.clientIp);
  acc.latencySum += r.timeTaken;
  const t = Date.parse(r.timestamp);
  if (t > acc.lastSeen) acc.lastSeen = t;
  if (t < acc.firstSeen) acc.firstSeen = t;
}

function accToTopN(acc: GroupAcc, totalRequests: number): TopNRow {
  return {
    key: acc.key,
    label: acc.label,
    requests: acc.requests,
    uniqueVisitors: acc.visitors.size,
    bytes: acc.bytes,
    errorRate: acc.requests ? acc.err / acc.requests : 0,
    cacheHitRatio: acc.cacheConsidered ? acc.cacheHit / acc.cacheConsidered : 0,
    share: totalRequests ? acc.requests / totalRequests : 0,
  };
}

function sortRows<T>(rows: T[], by: (r: T) => number, dir: "asc" | "desc") {
  rows.sort((a, b) => (dir === "asc" ? by(a) - by(b) : by(b) - by(a)));
}

export class MockDataSource implements DataSource {
  readonly name = "mock";

  async summary(filter: Filter): Promise<Summary> {
    const { rows, from, to } = filterRecords(filter);
    const s = computeSummary(rows);

    // Delta vs the immediately preceding equal-length window.
    const span = to.getTime() - from.getTime();
    const prevFilter: Filter = {
      ...filter,
      range: filter.range,
      from: new Date(from.getTime() - span).toISOString(),
      to: new Date(from.getTime()).toISOString(),
    };
    const prev = computeSummary(filterRecords(prevFilter).rows);
    s.delta = ratioDelta(s, prev);
    return s;
  }

  async timeseries(filter: Filter, opts: TimeseriesOptions = {}): Promise<TimePoint[]> {
    const { rows, from, to } = filterRecords(filter);
    const spanSec = (to.getTime() - from.getTime()) / 1000;
    const bucket = (opts.bucketSeconds ?? autoBucketSeconds(spanSec)) * 1000;
    const startAligned = Math.floor(from.getTime() / bucket) * bucket;
    const buckets = new Map<number, TimePoint & { _visitors: Set<string>; _lat: number; _lats: number[] }>();

    for (let t = startAligned; t <= to.getTime(); t += bucket) {
      buckets.set(t, blankPoint(new Date(t).toISOString()));
    }
    for (const r of rows) {
      const b = Math.floor(Date.parse(r.timestamp) / bucket) * bucket;
      const p = buckets.get(b);
      if (!p) continue;
      p.requests++;
      p.bytes += r.responseBytes;
      p._visitors.add(r.clientIp);
      p._lat += r.timeTaken;
      p._lats.push(r.timeTaken);
      const cls = statusClass(r.status);
      if (cls === "2xx") p.status2xx++;
      else if (cls === "3xx") p.status3xx++;
      else if (cls === "4xx") p.status4xx++;
      else if (cls === "5xx") p.status5xx++;
      if (isCacheHit(r.cacheStatus)) p.cacheHit++;
      else if (r.cacheStatus === "MISS") p.cacheMiss++;
    }
    return [...buckets.values()].map((p) => {
      p.uniqueVisitors = p._visitors.size;
      p.avgLatencyMs = p.requests ? (p._lat / p.requests) * 1000 : 0;
      p.p95LatencyMs = percentile([...p._lats].sort((a, b) => a - b), 95) * 1000;
      const { _visitors, _lat, _lats, ...clean } = p;
      void _visitors;
      void _lat;
      void _lats;
      return clean;
    });
  }

  async topN(filter: Filter, opts: TopNOptions): Promise<TopNRow[]> {
    const { rows } = filterRecords(filter);
    return computeTopN(rows, opts);
  }

  async geo(filter: Filter): Promise<GeoRow[]> {
    const { rows } = filterRecords(filter);
    const map = new Map<string, GroupAcc>();
    let total = 0;
    for (const r of rows) {
      total++;
      let acc = map.get(r.country);
      if (!acc) {
        acc = newAcc(r.country, r.countryName);
        map.set(r.country, acc);
      }
      accumulate(acc, r);
    }
    const out: GeoRow[] = [...map.values()].map((acc) => ({
      country: acc.key,
      countryName: acc.label,
      requests: acc.requests,
      uniqueVisitors: acc.visitors.size,
      bytes: acc.bytes,
      errorRate: acc.requests ? acc.err / acc.requests : 0,
      cacheHitRatio: acc.cacheConsidered ? acc.cacheHit / acc.cacheConsidered : 0,
      share: total ? acc.requests / total : 0,
    }));
    sortRows(out, (r) => r.requests, "desc");
    return out;
  }

  async paths(
    filter: Filter,
    opts: PathExplorerOptions = {},
  ): Promise<{ rows: PathRow[]; total: number }> {
    const { rows } = filterRecords(filter);
    const depth = opts.depth ?? 0;
    const map = new Map<string, GroupAcc>();
    let total = 0;
    for (const r of rows) {
      total++;
      const path = depth > 0 ? trimPath(r.path, depth) : r.path;
      const key = `${r.host}\u0000${path}`;
      let acc = map.get(key);
      if (!acc) {
        acc = newAcc(key, `${r.host}${path}`);
        map.set(key, acc);
      }
      accumulate(acc, r);
    }
    let out: PathRow[] = [...map.values()].map((acc) => {
      const [host, path] = acc.key.split("\u0000");
      return {
        host,
        path,
        requests: acc.requests,
        uniqueVisitors: acc.visitors.size,
        bytes: acc.bytes,
        errorRate: acc.requests ? acc.err / acc.requests : 0,
        cacheHitRatio: acc.cacheConsidered ? acc.cacheHit / acc.cacheConsidered : 0,
        avgLatencyMs: acc.requests ? (acc.latencySum / acc.requests) * 1000 : 0,
        status2xx: acc.s2,
        status3xx: acc.s3,
        status4xx: acc.s4,
        status5xx: acc.s5,
        share: total ? acc.requests / total : 0,
        lastSeen: new Date(acc.lastSeen).toISOString(),
      };
    });
    const totalGroups = out.length;
    const by = opts.sortBy ?? "requests";
    sortRows(out, (r) => r[by] as number, opts.sortDir ?? "desc");
    const offset = opts.offset ?? 0;
    out = out.slice(offset, offset + (opts.limit ?? 100));
    return { rows: out, total: totalGroups };
  }

  async pathVisitors(
    filter: Filter,
    host: string,
    path: string,
    opts: VisitorsOptions = {},
  ): Promise<{ rows: VisitorRow[]; total: number }> {
    const { rows } = filterRecords(filter);
    const matched = rows.filter(
      (r) => r.host === host && (r.path === path || r.path.startsWith(path.endsWith("/") ? path : path + "/")),
    );
    return aggregateVisitors(matched, opts);
  }

  async visitors(
    filter: Filter,
    opts: VisitorsOptions = {},
  ): Promise<{ rows: VisitorRow[]; total: number }> {
    const { rows } = filterRecords(filter);
    return aggregateVisitors(rows, opts);
  }

  async visitorDetail(filter: Filter, clientIp: string): Promise<VisitorDetail | null> {
    const { rows } = filterRecords(filter);
    const mine = rows.filter((r) => r.clientIp === clientIp);
    if (mine.length === 0) return null;
    const visitor = aggregateVisitors(mine, { limit: 1 }).rows[0];
    const topPaths = computeTopN(mine, { dimension: "path", limit: 15 });
    const pops = computeTopN(mine, { dimension: "pop", limit: 10 });
    const userAgents = computeTopN(mine, { dimension: "uaFamily", limit: 10 });
    const statusMap = new Map<StatusClass, number>();
    for (const r of mine) {
      const c = statusClass(r.status);
      statusMap.set(c, (statusMap.get(c) ?? 0) + 1);
    }
    const ipFilter: Filter = { ...filter, clientIp: [clientIp] };
    const timeline = await this.timeseries(ipFilter);
    const recent = [...mine]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 50);
    return {
      visitor,
      topPaths,
      pops,
      userAgents,
      statusBreakdown: [...statusMap.entries()].map(([key, requests]) => ({ key, requests })),
      timeline,
      recent,
    };
  }

  async logs(filter: Filter, opts: LogsOptions = {}): Promise<LogsPage> {
    const { rows } = filterRecords(filter);
    const dir = opts.sortDir ?? "desc";
    rows.sort((a, b) =>
      dir === "asc" ? a.timestamp.localeCompare(b.timestamp) : b.timestamp.localeCompare(a.timestamp),
    );
    const limit = opts.limit ?? 100;
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const page = rows.slice(start, start + limit);
    const next = start + limit < rows.length ? String(start + limit) : null;
    return { rows: page, total: rows.length, nextCursor: next };
  }

  async facetValues(filter: Filter, dimension: Dimension, limit = 50): Promise<TopNRow[]> {
    const { rows } = filterRecords(filter);
    return computeTopN(rows, { dimension, limit });
  }

  async proxyChains(filter: Filter, limit = 12): Promise<ProxyChains> {
    const { rows } = filterRecords(filter);
    return computeProxyChains(rows, limit);
  }
}

// ---- shared aggregation helpers ----

/** Count proxied requests (SocketIp != ClientIp) and rank the top proxied clients. */
function computeProxyChains(rows: AccessLogRecord[], limit: number): ProxyChains {
  let proxied = 0;
  // clientIp -> { requests, sockets }
  const byClient = new Map<string, { requests: number; sockets: Set<string> }>();
  for (const r of rows) {
    if (r.socketIp === r.clientIp) continue;
    proxied++;
    let e = byClient.get(r.clientIp);
    if (!e) {
      e = { requests: 0, sockets: new Set() };
      byClient.set(r.clientIp, e);
    }
    e.requests++;
    e.sockets.add(r.socketIp);
  }
  const pairs = [...byClient.entries()]
    .map(([clientIp, e]) => ({
      clientIp,
      // Representative socket (first seen); distinctSockets carries the fan-out.
      socketIp: e.sockets.values().next().value ?? "",
      requests: e.requests,
      distinctSockets: e.sockets.size,
    }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, limit);
  return { total: rows.length, proxied, pairs };
}

function blankPoint(t: string): TimePoint & { _visitors: Set<string>; _lat: number; _lats: number[] } {
  return {
    t,
    requests: 0,
    uniqueVisitors: 0,
    bytes: 0,
    status2xx: 0,
    status3xx: 0,
    status4xx: 0,
    status5xx: 0,
    cacheHit: 0,
    cacheMiss: 0,
    avgLatencyMs: 0,
    p95LatencyMs: 0,
    _visitors: new Set(),
    _lat: 0,
    _lats: [],
  };
}

function computeSummary(rows: AccessLogRecord[]): Summary {
  let bytes = 0;
  let err4 = 0;
  let err5 = 0;
  let cacheHit = 0;
  let cacheConsidered = 0;
  let latSum = 0;
  const visitors = new Set<string>();
  const lat: number[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    bytes += r.responseBytes;
    const cls = statusClass(r.status);
    if (cls === "4xx") err4++;
    else if (cls === "5xx") err5++;
    if (isCacheHit(r.cacheStatus)) cacheHit++;
    if (isCacheConsidered(r.cacheStatus)) cacheConsidered++;
    visitors.add(r.clientIp);
    latSum += r.timeTaken;
    lat[i] = r.timeTaken;
  }
  lat.sort((a, b) => a - b);
  const n = rows.length;
  return {
    requests: n,
    uniqueVisitors: visitors.size,
    bytes,
    cacheHitRatio: cacheConsidered ? cacheHit / cacheConsidered : 0,
    errorRate4xx: n ? err4 / n : 0,
    errorRate5xx: n ? err5 / n : 0,
    avgLatencyMs: n ? (latSum / n) * 1000 : 0,
    p50LatencyMs: percentile(lat, 50) * 1000,
    p95LatencyMs: percentile(lat, 95) * 1000,
  };
}

function ratioDelta(cur: Summary, prev: Summary): Summary["delta"] {
  const keys: (keyof Omit<Summary, "delta">)[] = [
    "requests",
    "uniqueVisitors",
    "bytes",
    "cacheHitRatio",
    "errorRate4xx",
    "errorRate5xx",
    "avgLatencyMs",
    "p50LatencyMs",
    "p95LatencyMs",
  ];
  const d: Summary["delta"] = {};
  for (const k of keys) {
    const a = cur[k];
    const b = prev[k];
    d[k] = b ? (a - b) / b : a ? 1 : 0;
  }
  return d;
}

function computeTopN(rows: AccessLogRecord[], opts: TopNOptions): TopNRow[] {
  const map = new Map<string, GroupAcc>();
  let total = 0;
  for (const r of rows) {
    total++;
    const { key, label } = dimValue(r, opts.dimension);
    let acc = map.get(key);
    if (!acc) {
      acc = newAcc(key, label);
      map.set(key, acc);
    }
    accumulate(acc, r);
  }
  const out = [...map.values()].map((acc) => accToTopN(acc, total));
  const by = opts.sortBy ?? "requests";
  sortRows(out, (r) => r[by] as number, opts.sortDir ?? "desc");
  return out.slice(0, opts.limit ?? 20);
}

function aggregateVisitors(
  rows: AccessLogRecord[],
  opts: VisitorsOptions,
): { rows: VisitorRow[]; total: number } {
  interface VAcc {
    sample: AccessLogRecord;
    requests: number;
    bytes: number;
    err: number;
    paths: Set<string>;
    first: number;
    last: number;
  }
  const map = new Map<string, VAcc>();
  for (const r of rows) {
    let acc = map.get(r.clientIp);
    if (!acc) {
      acc = {
        sample: r,
        requests: 0,
        bytes: 0,
        err: 0,
        paths: new Set(),
        first: Number.MAX_SAFE_INTEGER,
        last: 0,
      };
      map.set(r.clientIp, acc);
    }
    acc.requests++;
    acc.bytes += r.responseBytes;
    const cls = statusClass(r.status);
    if (cls === "4xx" || cls === "5xx") acc.err++;
    acc.paths.add(`${r.host}${r.path}`);
    const t = Date.parse(r.timestamp);
    if (t < acc.first) acc.first = t;
    if (t > acc.last) acc.last = t;
  }
  let out: VisitorRow[] = [...map.values()].map((acc) => {
    const s = acc.sample;
    return {
      clientIp: s.clientIp,
      country: s.country,
      countryName: s.countryName,
      city: s.city,
      asn: s.asn,
      asnOrg: s.asnOrg,
      uaFamily: s.uaFamily,
      deviceType: s.deviceType,
      ja4: s.ja4,
      requests: acc.requests,
      bytes: acc.bytes,
      distinctPaths: acc.paths.size,
      errorRate: acc.requests ? acc.err / acc.requests : 0,
      firstSeen: new Date(acc.first).toISOString(),
      lastSeen: new Date(acc.last).toISOString(),
    };
  });
  const total = out.length;
  const by = opts.sortBy ?? "requests";
  const valueOf = (r: VisitorRow): number =>
    by === "lastSeen" ? Date.parse(r.lastSeen) : (r[by] as number);
  sortRows(out, valueOf, opts.sortDir ?? "desc");
  const offset = opts.offset ?? 0;
  out = out.slice(offset, offset + (opts.limit ?? 100));
  return { rows: out, total };
}

function trimPath(path: string, depth: number): string {
  const segs = path.split("/").filter(Boolean);
  if (segs.length <= depth) return path;
  return "/" + segs.slice(0, depth).join("/");
}
