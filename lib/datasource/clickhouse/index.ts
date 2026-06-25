import { createClient, type ClickHouseClient } from "@clickhouse/client";

import type {
  AccessLogRecord,
  Dimension,
  GeoRow,
  LogsPage,
  PathRow,
  StatusClass,
  Summary,
  TimePoint,
  TopNRow,
  VisitorDetail,
  VisitorRow,
} from "@/lib/domain/types";
import type {
  DataSource,
  LogsOptions,
  PathExplorerOptions,
  TimeseriesOptions,
  TopNOptions,
  VisitorsOptions,
} from "@/lib/datasource/types";
import { resolveTimeRange, type Filter } from "@/lib/filters/model";
import {
  applyFilter,
  applyRollupFilter,
  autoBucketSeconds,
  CACHE_CONSIDERED,
  CACHE_HIT,
  canUseTrafficRollup,
  dimExpr,
  pathGroupExpr,
  SqlBuilder,
} from "@/lib/datasource/clickhouse/sql";

const TABLE = "afd.access_logs";
const ROLLUP_TRAFFIC = "afd.rollup_traffic_1m";
const n = (v: unknown): number => Number(v ?? 0);

/** Rollups are used for compatible filters unless explicitly disabled. */
const rollupsEnabled = (): boolean => (process.env.AFD_ROLLUPS ?? "on") !== "off";

/** Whitelist the sort direction; never inline raw client input into SQL. */
const dirSql = (d?: string): "ASC" | "DESC" =>
  (d ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";

function tsToIso(s: string): string {
  return new Date(s.replace(" ", "T") + (s.includes("Z") ? "" : "Z")).toISOString();
}

function whereFor(f: Filter): { where: string; params: Record<string, unknown>; from: Date; to: Date } {
  const { from, to } = resolveTimeRange(f);
  const s = new SqlBuilder();
  applyFilter(s, f, from, to);
  return { where: s.where(), params: s.params, from, to };
}

const TOPN_ORDER: Record<string, string> = {
  requests: "requests",
  uniqueVisitors: "uniqueVisitors",
  bytes: "bytes",
  errorRate: "err / greatest(requests, 1)",
};
const VISITOR_ORDER: Record<string, string> = {
  requests: "requests",
  bytes: "bytes",
  distinctPaths: "distinctPaths",
  errorRate: "err / greatest(requests, 1)",
  lastSeen: "lastSeen",
};

export class ClickHouseDataSource implements DataSource {
  readonly name = "clickhouse";
  private _client: ClickHouseClient | null = null;

  private client(): ClickHouseClient {
    if (!this._client) {
      this._client = createClient({
        url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
        username: process.env.CLICKHOUSE_USER ?? "default",
        password: process.env.CLICKHOUSE_PASSWORD ?? "",
        database: process.env.CLICKHOUSE_DATABASE ?? "afd",
        clickhouse_settings: { date_time_output_format: "iso" },
      });
    }
    return this._client;
  }

  private async run<T>(query: string, query_params: Record<string, unknown>): Promise<T[]> {
    const rs = await this.client().query({ query, query_params, format: "JSONEachRow" });
    return rs.json<T>();
  }

  // ---- summary ----
  private summaryRow(f: Filter, from: Date, to: Date) {
    return rollupsEnabled() && canUseTrafficRollup(f)
      ? this.summaryRowRollup(f, from, to)
      : this.summaryRowRaw(f, from, to);
  }

  private async summaryRowRaw(f: Filter, from: Date, to: Date) {
    const s = new SqlBuilder();
    applyFilter(s, f, from, to);
    const sql = `
      SELECT count() AS requests, uniqExact(clientIp) AS uniqueVisitors,
             sum(responseBytes) AS bytes,
             countIf(${CACHE_HIT}) AS cacheHit, countIf(${CACHE_CONSIDERED}) AS cacheConsidered,
             countIf(statusClass = 4) AS err4, countIf(statusClass = 5) AS err5,
             avg(timeTaken) AS avgLat,
             quantileExact(0.5)(timeTaken) AS p50, quantileExact(0.95)(timeTaken) AS p95
      FROM ${TABLE} WHERE ${s.where()}`;
    const [r] = await this.run<Record<string, unknown>>(sql, s.params);
    const requests = n(r?.requests);
    return {
      requests,
      uniqueVisitors: n(r?.uniqueVisitors),
      bytes: n(r?.bytes),
      cacheHitRatio: n(r?.cacheConsidered) ? n(r?.cacheHit) / n(r?.cacheConsidered) : 0,
      errorRate4xx: requests ? n(r?.err4) / requests : 0,
      errorRate5xx: requests ? n(r?.err5) / requests : 0,
      avgLatencyMs: n(r?.avgLat) * 1000,
      p50LatencyMs: n(r?.p50) * 1000,
      p95LatencyMs: n(r?.p95) * 1000,
    } satisfies Omit<Summary, "delta">;
  }

  private async summaryRowRollup(f: Filter, from: Date, to: Date) {
    const s = new SqlBuilder();
    applyRollupFilter(s, f, from, to);
    const sql = `
      SELECT sum(requests) AS requests, uniqMerge(visitors) AS uniqueVisitors,
             sum(bytes) AS bytes,
             sumIf(requests, ${CACHE_HIT}) AS cacheHit, sumIf(requests, ${CACHE_CONSIDERED}) AS cacheConsidered,
             sumIf(requests, statusClass = 4) AS err4, sumIf(requests, statusClass = 5) AS err5,
             sum(latencySum) AS latSum,
             arrayElement(quantilesMerge(0.5, 0.95)(latency), 1) AS p50,
             arrayElement(quantilesMerge(0.5, 0.95)(latency), 2) AS p95
      FROM ${ROLLUP_TRAFFIC} WHERE ${s.where()}`;
    const [r] = await this.run<Record<string, unknown>>(sql, s.params);
    const requests = n(r?.requests);
    return {
      requests,
      uniqueVisitors: n(r?.uniqueVisitors),
      bytes: n(r?.bytes),
      cacheHitRatio: n(r?.cacheConsidered) ? n(r?.cacheHit) / n(r?.cacheConsidered) : 0,
      errorRate4xx: requests ? n(r?.err4) / requests : 0,
      errorRate5xx: requests ? n(r?.err5) / requests : 0,
      avgLatencyMs: requests ? (n(r?.latSum) / requests) * 1000 : 0,
      p50LatencyMs: n(r?.p50) * 1000,
      p95LatencyMs: n(r?.p95) * 1000,
    } satisfies Omit<Summary, "delta">;
  }

  async summary(f: Filter): Promise<Summary> {
    const { from, to } = resolveTimeRange(f);
    const span = to.getTime() - from.getTime();
    const [cur, prev] = await Promise.all([
      this.summaryRow(f, from, to),
      this.summaryRow(f, new Date(from.getTime() - span), from),
    ]);
    const keys = Object.keys(cur) as (keyof typeof cur)[];
    const delta: Summary["delta"] = {};
    for (const k of keys) delta[k] = prev[k] ? (cur[k] - prev[k]) / prev[k] : cur[k] ? 1 : 0;
    return { ...cur, delta };
  }

  // ---- timeseries ----
  async timeseries(f: Filter, opts: TimeseriesOptions = {}): Promise<TimePoint[]> {
    const useRollup = rollupsEnabled() && canUseTrafficRollup(f);
    const { from, to } = resolveTimeRange(f);
    const bucket = Math.max(
      useRollup ? 60 : 1,
      Math.floor(opts.bucketSeconds ?? autoBucketSeconds((to.getTime() - from.getTime()) / 1000)),
    );
    const s = new SqlBuilder();
    if (useRollup) applyRollupFilter(s, f, from, to);
    else applyFilter(s, f, from, to);
    const where = s.where();

    let i = Object.keys(s.params).length;
    const fromP = `{f${i}:Int64}`;
    s.params[`f${i++}`] = from.getTime();
    const toP = `{f${i}:Int64}`;
    s.params[`f${i}`] = to.getTime();

    const timeCol = useRollup ? "bucket" : "timestamp";
    const cnt = useRollup ? "sum(requests)" : "count()";
    const visitors = useRollup ? "uniqMerge(visitors)" : "uniqExact(clientIp)";
    const bytes = useRollup ? "sum(bytes)" : "sum(responseBytes)";
    const cls = (k: number) =>
      useRollup ? `sumIf(requests, statusClass = ${k})` : `countIf(statusClass = ${k})`;
    const hit = useRollup ? `sumIf(requests, ${CACHE_HIT})` : `countIf(${CACHE_HIT})`;
    const miss = useRollup ? "sumIf(requests, cacheStatus = 'MISS')" : "countIf(cacheStatus = 'MISS')";
    const avgLat = useRollup ? "sum(latencySum) / greatest(sum(requests), 1)" : "avg(timeTaken)";

    const sql = `
      SELECT toStartOfInterval(${timeCol}, INTERVAL ${bucket} SECOND) AS t,
             ${cnt} AS requests, ${visitors} AS uniqueVisitors, ${bytes} AS bytes,
             ${cls(2)} AS status2xx, ${cls(3)} AS status3xx,
             ${cls(4)} AS status4xx, ${cls(5)} AS status5xx,
             ${hit} AS cacheHit, ${miss} AS cacheMiss,
             ${avgLat} AS avgLat
      FROM ${useRollup ? ROLLUP_TRAFFIC : TABLE} WHERE ${where}
      GROUP BY t ORDER BY t
      WITH FILL FROM toStartOfInterval(fromUnixTimestamp64Milli(${fromP}), INTERVAL ${bucket} SECOND)
                TO fromUnixTimestamp64Milli(${toP}) STEP toIntervalSecond(${bucket})`;
    const rows = await this.run<Record<string, unknown>>(sql, s.params);
    return rows.map((r) => ({
      t: tsToIso(String(r.t)),
      requests: n(r.requests),
      uniqueVisitors: n(r.uniqueVisitors),
      bytes: n(r.bytes),
      status2xx: n(r.status2xx),
      status3xx: n(r.status3xx),
      status4xx: n(r.status4xx),
      status5xx: n(r.status5xx),
      cacheHit: n(r.cacheHit),
      cacheMiss: n(r.cacheMiss),
      avgLatencyMs: n(r.avgLat) * 1000,
    }));
  }

  // ---- topN ----
  async topN(f: Filter, opts: TopNOptions): Promise<TopNRow[]> {
    const { where, params } = whereFor(f);
    const { key, label } = dimExpr(opts.dimension);
    const order = TOPN_ORDER[opts.sortBy ?? "requests"] ?? "requests";
    const dir = dirSql(opts.sortDir);
    const limit = Math.max(1, Math.min(1000, opts.limit ?? 20));
    const sql = `
      SELECT ${key} AS k, ${label} AS label, count() AS requests,
             uniqExact(clientIp) AS uniqueVisitors, sum(responseBytes) AS bytes,
             countIf(statusClass IN (4,5)) AS err,
             countIf(${CACHE_HIT}) AS cacheHit, countIf(${CACHE_CONSIDERED}) AS cacheConsidered,
             (SELECT count() FROM ${TABLE} WHERE ${where}) AS total
      FROM ${TABLE} WHERE ${where} GROUP BY k, label ORDER BY ${order} ${dir} LIMIT ${limit}`;
    const rows = await this.run<Record<string, unknown>>(sql, params);
    return rows.map((r) => toTopN(r));
  }

  async geo(f: Filter): Promise<GeoRow[]> {
    const useRollup = rollupsEnabled() && canUseTrafficRollup(f);
    const { from, to } = resolveTimeRange(f);
    const s = new SqlBuilder();
    if (useRollup) applyRollupFilter(s, f, from, to);
    else applyFilter(s, f, from, to);
    const where = s.where();
    const tbl = useRollup ? ROLLUP_TRAFFIC : TABLE;
    const cnt = useRollup ? "sum(requests)" : "count()";
    const visitors = useRollup ? "uniqMerge(visitors)" : "uniqExact(clientIp)";
    const bytes = useRollup ? "sum(bytes)" : "sum(responseBytes)";
    const err = useRollup
      ? "sumIf(requests, statusClass IN (4,5))"
      : "countIf(statusClass IN (4,5))";
    const hit = useRollup ? `sumIf(requests, ${CACHE_HIT})` : `countIf(${CACHE_HIT})`;
    const considered = useRollup
      ? `sumIf(requests, ${CACHE_CONSIDERED})`
      : `countIf(${CACHE_CONSIDERED})`;
    const sql = `
      SELECT country, any(countryName) AS countryName, ${cnt} AS requests,
             ${visitors} AS uniqueVisitors, ${bytes} AS bytes,
             ${err} AS err, ${hit} AS cacheHit, ${considered} AS cacheConsidered,
             (SELECT ${cnt} FROM ${tbl} WHERE ${where}) AS total
      FROM ${tbl} WHERE ${where} GROUP BY country ORDER BY requests DESC`;
    const rows = await this.run<Record<string, unknown>>(sql, s.params);
    return rows.map((r) => {
      const requests = n(r.requests);
      return {
        country: String(r.country),
        countryName: String(r.countryName || r.country),
        requests,
        uniqueVisitors: n(r.uniqueVisitors),
        bytes: n(r.bytes),
        errorRate: requests ? n(r.err) / requests : 0,
        cacheHitRatio: n(r.cacheConsidered) ? n(r.cacheHit) / n(r.cacheConsidered) : 0,
        share: n(r.total) ? requests / n(r.total) : 0,
      };
    });
  }

  // ---- paths ----
  async paths(f: Filter, opts: PathExplorerOptions = {}): Promise<{ rows: PathRow[]; total: number }> {
    const { where, params } = whereFor(f);
    const pe = pathGroupExpr(opts.depth ?? 0);
    const order = PATHS_ORDER[opts.sortBy ?? "requests"] ?? "requests";
    const dir = dirSql(opts.sortDir);
    const limit = Math.max(1, Math.min(1000, opts.limit ?? 100));
    const offset = Math.max(0, opts.offset ?? 0);

    const sql = `
      SELECT host, ${pe} AS path, count() AS requests, uniqExact(clientIp) AS uniqueVisitors,
             sum(responseBytes) AS bytes, countIf(statusClass IN (4,5)) AS err,
             countIf(${CACHE_HIT}) AS cacheHit, countIf(${CACHE_CONSIDERED}) AS cacheConsidered,
             countIf(statusClass = 2) AS s2, countIf(statusClass = 3) AS s3,
             countIf(statusClass = 4) AS s4, countIf(statusClass = 5) AS s5,
             avg(timeTaken) AS avgLat, max(timestamp) AS lastSeen,
             (SELECT count() FROM ${TABLE} WHERE ${where}) AS total
      FROM ${TABLE} WHERE ${where} GROUP BY host, path ORDER BY ${order} ${dir} LIMIT ${limit} OFFSET ${offset}`;
    const countSql = `SELECT count() AS c FROM (SELECT host, ${pe} AS p FROM ${TABLE} WHERE ${where} GROUP BY host, p)`;
    const [rows, [cnt]] = await Promise.all([
      this.run<Record<string, unknown>>(sql, params),
      this.run<Record<string, unknown>>(countSql, params),
    ]);
    return {
      total: n(cnt?.c),
      rows: rows.map((r) => {
        const requests = n(r.requests);
        return {
          host: String(r.host),
          path: String(r.path),
          requests,
          uniqueVisitors: n(r.uniqueVisitors),
          bytes: n(r.bytes),
          errorRate: requests ? n(r.err) / requests : 0,
          cacheHitRatio: n(r.cacheConsidered) ? n(r.cacheHit) / n(r.cacheConsidered) : 0,
          avgLatencyMs: n(r.avgLat) * 1000,
          status2xx: n(r.s2),
          status3xx: n(r.s3),
          status4xx: n(r.s4),
          status5xx: n(r.s5),
          share: n(r.total) ? requests / n(r.total) : 0,
          lastSeen: tsToIso(String(r.lastSeen)),
        };
      }),
    };
  }

  // ---- visitors ----
  private async visitorAgg(
    where: string,
    params: Record<string, unknown>,
    opts: VisitorsOptions,
  ): Promise<{ rows: VisitorRow[]; total: number }> {
    const order = VISITOR_ORDER[opts.sortBy ?? "requests"] ?? "requests";
    const dir = dirSql(opts.sortDir);
    const limit = Math.max(1, Math.min(1000, opts.limit ?? 100));
    const offset = Math.max(0, opts.offset ?? 0);
    const sql = `
      SELECT clientIp, any(country) AS country, any(countryName) AS countryName, any(city) AS city,
             any(asn) AS asn, any(asnOrg) AS asnOrg, any(uaFamily) AS uaFamily,
             any(deviceType) AS deviceType, any(ja4) AS ja4,
             count() AS requests, sum(responseBytes) AS bytes, uniqExact(hostPath) AS distinctPaths,
             countIf(statusClass IN (4,5)) AS err, min(timestamp) AS firstSeen, max(timestamp) AS lastSeen
      FROM ${TABLE} WHERE ${where} GROUP BY clientIp ORDER BY ${order} ${dir} LIMIT ${limit} OFFSET ${offset}`;
    const totalSql = `SELECT uniqExact(clientIp) AS c FROM ${TABLE} WHERE ${where}`;
    const [rows, [cnt]] = await Promise.all([
      this.run<Record<string, unknown>>(sql, params),
      this.run<Record<string, unknown>>(totalSql, params),
    ]);
    return {
      total: n(cnt?.c),
      rows: rows.map((r) => {
        const requests = n(r.requests);
        return {
          clientIp: String(r.clientIp),
          country: String(r.country),
          countryName: String(r.countryName || r.country),
          city: String(r.city),
          asn: n(r.asn),
          asnOrg: String(r.asnOrg),
          uaFamily: String(r.uaFamily),
          deviceType: String(r.deviceType) as VisitorRow["deviceType"],
          ja4: String(r.ja4),
          requests,
          bytes: n(r.bytes),
          distinctPaths: n(r.distinctPaths),
          errorRate: requests ? n(r.err) / requests : 0,
          firstSeen: tsToIso(String(r.firstSeen)),
          lastSeen: tsToIso(String(r.lastSeen)),
        };
      }),
    };
  }

  async visitors(f: Filter, opts: VisitorsOptions = {}): Promise<{ rows: VisitorRow[]; total: number }> {
    const { where, params } = whereFor(f);
    return this.visitorAgg(where, params, opts);
  }

  async pathVisitors(
    f: Filter,
    host: string,
    path: string,
    opts: VisitorsOptions = {},
  ): Promise<{ rows: VisitorRow[]; total: number }> {
    const { from, to } = resolveTimeRange(f);
    const s = new SqlBuilder();
    applyFilter(s, f, from, to);
    s.push(`host = ${s.param("String", host)}`);
    const sub = path.endsWith("/") ? path : path + "/";
    s.push(`(path = ${s.param("String", path)} OR startsWith(path, ${s.param("String", sub)}))`);
    return this.visitorAgg(s.where(), s.params, opts);
  }

  async visitorDetail(f: Filter, clientIp: string): Promise<VisitorDetail | null> {
    const f2: Filter = { ...f, clientIp: [clientIp] };
    const visitorPage = await this.visitors(f2, { limit: 1 });
    const visitor = visitorPage.rows[0];
    if (!visitor) return null;

    const { where, params } = whereFor(f2);
    const statusSql = `SELECT concat(toString(statusClass),'xx') AS key, count() AS requests
                       FROM ${TABLE} WHERE ${where} GROUP BY statusClass ORDER BY requests DESC`;

    const [topPaths, pops, userAgents, statusRows, timeline, logsPage] = await Promise.all([
      this.topN(f2, { dimension: "path", limit: 15 }),
      this.topN(f2, { dimension: "pop", limit: 10 }),
      this.topN(f2, { dimension: "uaFamily", limit: 10 }),
      this.run<Record<string, unknown>>(statusSql, params),
      this.timeseries(f2),
      this.logs(f2, { limit: 50 }),
    ]);

    return {
      visitor,
      topPaths,
      pops,
      userAgents,
      statusBreakdown: statusRows.map((r) => ({
        key: String(r.key) as StatusClass,
        requests: n(r.requests),
      })),
      timeline,
      recent: logsPage.rows,
    };
  }

  // ---- raw logs ----
  async logs(f: Filter, opts: LogsOptions = {}): Promise<LogsPage> {
    const { where, params } = whereFor(f);
    const dir = dirSql(opts.sortDir);
    const limit = Math.max(1, Math.min(5000, opts.limit ?? 100));
    const offset = Math.max(0, Math.floor(Number(opts.cursor)) || 0);
    const rowsSql = `SELECT * FROM ${TABLE} WHERE ${where} ORDER BY timestamp ${dir} LIMIT ${limit} OFFSET ${offset}`;
    const totalSql = `SELECT count() AS c FROM ${TABLE} WHERE ${where}`;
    const [raw, [cnt]] = await Promise.all([
      this.run<Record<string, unknown>>(rowsSql, params),
      this.run<Record<string, unknown>>(totalSql, params),
    ]);
    const total = n(cnt?.c);
    return {
      rows: raw.map(mapRecord),
      total,
      nextCursor: offset + limit < total ? String(offset + limit) : null,
    };
  }

  async facetValues(f: Filter, dimension: Dimension, limit = 50): Promise<TopNRow[]> {
    return this.topN(f, { dimension, limit });
  }
}

const PATHS_ORDER: Record<string, string> = {
  requests: "requests",
  uniqueVisitors: "uniqueVisitors",
  bytes: "bytes",
  errorRate: "err / greatest(requests, 1)",
  avgLatencyMs: "avgLat",
};

function toTopN(r: Record<string, unknown>): TopNRow {
  const requests = n(r.requests);
  return {
    key: String(r.k),
    label: String(r.label ?? r.k),
    requests,
    uniqueVisitors: n(r.uniqueVisitors),
    bytes: n(r.bytes),
    errorRate: requests ? n(r.err) / requests : 0,
    cacheHitRatio: n(r.cacheConsidered) ? n(r.cacheHit) / n(r.cacheConsidered) : 0,
    share: n(r.total) ? requests / n(r.total) : 0,
  };
}

function mapRecord(r: Record<string, unknown>): AccessLogRecord {
  return {
    trackingRef: String(r.trackingRef),
    timestamp: tsToIso(String(r.timestamp)),
    method: String(r.method),
    httpVersion: String(r.httpVersion),
    scheme: String(r.scheme) as AccessLogRecord["scheme"],
    host: String(r.host),
    path: String(r.path),
    query: String(r.query ?? ""),
    url: String(r.url),
    status: n(r.status),
    protocol: String(r.protocol) as AccessLogRecord["protocol"],
    requestBytes: n(r.requestBytes),
    responseBytes: n(r.responseBytes),
    timeTaken: n(r.timeTaken),
    timeToFirstByte: n(r.timeToFirstByte),
    clientIp: String(r.clientIp),
    socketIp: String(r.socketIp),
    clientPort: n(r.clientPort),
    country: String(r.country),
    countryName: String(r.countryName),
    city: String(r.city),
    latitude: n(r.latitude),
    longitude: n(r.longitude),
    asn: n(r.asn),
    asnOrg: String(r.asnOrg),
    userAgent: String(r.userAgent),
    uaFamily: String(r.uaFamily),
    uaOs: String(r.uaOs),
    deviceType: String(r.deviceType) as AccessLogRecord["deviceType"],
    ja4: String(r.ja4),
    referer: String(r.referer ?? ""),
    endpoint: String(r.endpoint),
    pop: String(r.pop),
    cacheStatus: String(r.cacheStatus) as AccessLogRecord["cacheStatus"],
    routeName: String(r.routeName),
    ruleSetName: String(r.ruleSetName ?? ""),
    securityProtocol: String(r.securityProtocol),
    errorInfo: String(r.errorInfo),
    originName: String(r.originName),
    originStatus: n(r.originStatus),
  };
}
