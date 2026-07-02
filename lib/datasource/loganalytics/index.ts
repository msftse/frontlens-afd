import "server-only";

import {
  LogsQueryClient,
  LogsQueryResultStatus,
  type LogsTable,
} from "@azure/monitor-query";
import { DefaultAzureCredential } from "@azure/identity";

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
import type {
  DataSource,
  LogsOptions,
  PathExplorerOptions,
  TimeseriesOptions,
  TopNOptions,
  VisitorsOptions,
  WafDataSource,
} from "@/lib/datasource/types";
import { resolveTimeRange, type Filter } from "@/lib/filters/model";
import { createLogAnalyticsWaf } from "@/lib/datasource/loganalytics/waf";
import {
  autoBucketSeconds,
  baseProjection,
  CACHE_CONSIDERED,
  CACHE_HIT,
  CATEGORY,
  dimExpr,
  facetConditions,
  geoProjection,
  kstr,
  pathGroupExpr,
  TABLE,
  timeConditions,
} from "@/lib/datasource/loganalytics/kql";
import { countryNameToIso2, iso2ToCountryName } from "@/lib/datasource/loganalytics/countries";

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v == null ? "" : String(v));

const dir = (d?: string): "asc" | "desc" => (d === "asc" ? "asc" : "desc");
const clampLimit = (v: number | undefined, def: number, max: number) =>
  Math.max(1, Math.min(max, Math.floor(v ?? def)));

const TOPN_ORDER: Record<string, string> = {
  requests: "requests",
  uniqueVisitors: "uniqueVisitors",
  bytes: "bytes",
  errorRate: "todouble(err) / todouble(max_of(requests, 1))",
};
const VISITOR_ORDER: Record<string, string> = {
  requests: "requests",
  bytes: "bytes",
  distinctPaths: "distinctPaths",
  errorRate: "todouble(err) / todouble(max_of(requests, 1))",
  lastSeen: "lastSeen",
};
const PATHS_ORDER: Record<string, string> = {
  requests: "requests",
  uniqueVisitors: "uniqueVisitors",
  bytes: "bytes",
  errorRate: "todouble(err) / todouble(max_of(requests, 1))",
  avgLatencyMs: "avgMs",
};

/**
 * Live data source backed by Azure Log Analytics (Kusto). Reads Azure Front
 * Door access logs straight from the workspace the AFD diagnostic setting
 * streams to - no extra database or always-on compute.
 *
 * Auth: a user-assigned managed identity in Azure (set `AZURE_CLIENT_ID`), or
 * the Azure CLI credential locally - both via `DefaultAzureCredential`. The
 * workspace id comes from `LOG_ANALYTICS_WORKSPACE_ID`.
 *
 * Every query is bounded by `TimeGenerated` and projects a minimal set of
 * columns, because Log Analytics bills per GB scanned.
 */
export class LogAnalyticsDataSource implements DataSource {
  readonly name = "loganalytics";
  private _client: LogsQueryClient | null = null;
  private _waf: WafDataSource | null = null;

  /** WAF surface over FrontDoorWebApplicationFirewallLog (same workspace). */
  get waf(): WafDataSource {
    if (!this._waf) {
      this._waf = createLogAnalyticsWaf((kql) => this.run(kql));
    }
    return this._waf;
  }

  private client(): LogsQueryClient {
    if (!this._client) {
      this._client = new LogsQueryClient(new DefaultAzureCredential());
    }
    return this._client;
  }

  private workspaceId(): string {
    const id = process.env.LOG_ANALYTICS_WORKSPACE_ID;
    if (!id) {
      throw new Error(
        "LOG_ANALYTICS_WORKSPACE_ID is not set; cannot query the live data source.",
      );
    }
    return id;
  }

  /** Run a KQL query and return rows as plain objects keyed by column name. */
  private async run(kql: string): Promise<Record<string, unknown>[]> {
    const result = await this.client().queryWorkspace(this.workspaceId(), kql, {
      duration: "P90D",
    });
    if (result.status === LogsQueryResultStatus.Success) {
      return rowsOf(result.tables[0]);
    }
    // Partial results still carry a table; surface a clear error otherwise.
    const partial = (result as { partialTables?: LogsTable[] }).partialTables?.[0];
    if (partial) return rowsOf(partial);
    const err = (result as { partialError?: { message?: string } }).partialError;
    throw new Error(`Log Analytics query failed: ${err?.message ?? "unknown error"}`);
  }

  /**
   * Build the common query prefix: source table, category, time + facet filter,
   * then the normalized projection (+ geo enrichment when requested).
   */
  private prefix(f: Filter, from: Date, to: Date, opts?: { geo?: boolean }): string {
    const facets = facetConditions(f);
    return [
      TABLE,
      `| where Category == ${kstr(CATEGORY)}`,
      // Time bound first, on the raw column, so LA prunes before projecting.
      `| where ${timeConditions(from, to).join("\n    and ")}`,
      baseProjection(),
      opts?.geo ? geoProjection() : "",
      // Facets reference the projected column names, so they run AFTER it.
      facets.length ? `| where ${facets.join("\n    and ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  // ---- summary (current + previous window in ONE query) ----
  async summary(f: Filter): Promise<Summary> {
    const { from, to } = resolveTimeRange(f);
    const span = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - span);

    // Widen the time bound to cover the previous window, then split with iff().
    const facets = facetConditions(f);
    const cur = `TimeGenerated >= datetime(${from.toISOString()})`;
    const kql = [
      TABLE,
      `| where Category == ${kstr(CATEGORY)}`,
      `| where ${timeConditions(prevFrom, to).join("\n    and ")}`,
      baseProjection(),
      facets.length ? `| where ${facets.join("\n    and ")}` : "",
      `| extend _w = iff(${cur}, "cur", "prev")`,
      `| summarize requests = count(),`,
      `            uniqueVisitors = dcount(clientIp),`,
      `            bytes = sum(respBytes),`,
      `            cacheHit = countif(${CACHE_HIT}),`,
      `            cacheConsidered = countif(${CACHE_CONSIDERED}),`,
      `            err4 = countif(statusClass == 4),`,
      `            err5 = countif(statusClass == 5),`,
      `            avgMs = avg(ms),`,
      `            p50 = percentile(ms, 50),`,
      `            p95 = percentile(ms, 95)`,
      `          by _w`,
    ].join("\n");

    const rows = await this.run(kql);
    const curRow = rows.find((r) => r._w === "cur");
    const prevRow = rows.find((r) => r._w === "prev");
    const shape = (r: Record<string, unknown> | undefined): Omit<Summary, "delta"> => {
      const requests = num(r?.requests);
      return {
        requests,
        uniqueVisitors: num(r?.uniqueVisitors),
        bytes: num(r?.bytes),
        cacheHitRatio: num(r?.cacheConsidered) ? num(r?.cacheHit) / num(r?.cacheConsidered) : 0,
        errorRate4xx: requests ? num(r?.err4) / requests : 0,
        errorRate5xx: requests ? num(r?.err5) / requests : 0,
        avgLatencyMs: num(r?.avgMs),
        p50LatencyMs: num(r?.p50),
        p95LatencyMs: num(r?.p95),
      };
    };
    const curS = shape(curRow);
    const prevS = shape(prevRow);
    const keys = Object.keys(curS) as (keyof typeof curS)[];
    const delta: Summary["delta"] = {};
    for (const k of keys) delta[k] = prevS[k] ? (curS[k] - prevS[k]) / prevS[k] : curS[k] ? 1 : 0;
    return { ...curS, delta };
  }

  // ---- timeseries ----
  async timeseries(f: Filter, opts: TimeseriesOptions = {}): Promise<TimePoint[]> {
    const { from, to } = resolveTimeRange(f);
    const bucket = Math.max(
      1,
      Math.floor(opts.bucketSeconds ?? autoBucketSeconds((to.getTime() - from.getTime()) / 1000)),
    );
    const kql = [
      this.prefix(f, from, to),
      `| summarize requests = count(),`,
      `            uniqueVisitors = dcount(clientIp),`,
      `            bytes = sum(respBytes),`,
      `            status2xx = countif(statusClass == 2),`,
      `            status3xx = countif(statusClass == 3),`,
      `            status4xx = countif(statusClass == 4),`,
      `            status5xx = countif(statusClass == 5),`,
      `            cacheHit = countif(${CACHE_HIT}),`,
      `            cacheMiss = countif(cacheStatus == "MISS"),`,
      `            avgMs = avg(ms),`,
      `            p95Ms = percentile(ms, 95)`,
      `          by t = bin(TimeGenerated, ${bucket}s)`,
      `| order by t asc`,
    ].join("\n");
    const rows = await this.run(kql);
    return rows.map((r) => ({
      t: new Date(str(r.t)).toISOString(),
      requests: num(r.requests),
      uniqueVisitors: num(r.uniqueVisitors),
      bytes: num(r.bytes),
      status2xx: num(r.status2xx),
      status3xx: num(r.status3xx),
      status4xx: num(r.status4xx),
      status5xx: num(r.status5xx),
      cacheHit: num(r.cacheHit),
      cacheMiss: num(r.cacheMiss),
      avgLatencyMs: num(r.avgMs),
      p95LatencyMs: num(r.p95Ms),
    }));
  }

  // ---- topN ----
  async topN(f: Filter, opts: TopNOptions): Promise<TopNRow[]> {
    const { from, to } = resolveTimeRange(f);
    const { key, label, needsGeo } = dimExpr(opts.dimension);
    const order = TOPN_ORDER[opts.sortBy ?? "requests"] ?? "requests";
    const limit = clampLimit(opts.limit, 20, 1000);
    const kql = [
      this.prefix(f, from, to, { geo: needsGeo }),
      `| extend _k = ${key}, _label = ${label}`,
      `| summarize requests = count(), uniqueVisitors = dcount(clientIp),`,
      `            bytes = sum(respBytes), err = countif(statusClass == 4 or statusClass == 5),`,
      `            cacheHit = countif(${CACHE_HIT}), cacheConsidered = countif(${CACHE_CONSIDERED})`,
      `          by _k, _label`,
      `| extend _total = toscalar(${this.prefix(f, from, to)} | count)`,
      `| order by ${order} desc`,
      `| take ${limit}`,
    ].join("\n");
    const rows = await this.run(kql);
    return rows.map((r) => this.toTopN(r, opts.dimension));
  }

  private toTopN(r: Record<string, unknown>, dimension: Dimension): TopNRow {
    const requests = num(r.requests);
    let key = str(r._k);
    let label = str(r._label ?? r._k);
    if (dimension === "country") {
      // KQL grouped by country name; convert to ISO-2 for the key (matches filter + map).
      const iso2 = countryNameToIso2(key);
      label = iso2ToCountryName(iso2) || key;
      key = iso2;
    }
    return {
      key,
      label,
      requests,
      uniqueVisitors: num(r.uniqueVisitors),
      bytes: num(r.bytes),
      errorRate: requests ? num(r.err) / requests : 0,
      cacheHitRatio: num(r.cacheConsidered) ? num(r.cacheHit) / num(r.cacheConsidered) : 0,
      share: num(r._total) ? requests / num(r._total) : 0,
    };
  }

  // ---- geo ----
  async geo(f: Filter): Promise<GeoRow[]> {
    const { from, to } = resolveTimeRange(f);
    const kql = [
      this.prefix(f, from, to),
      `| summarize requests = count(), uniqueVisitors = dcount(clientIp),`,
      `            bytes = sum(respBytes), err = countif(statusClass == 4 or statusClass == 5),`,
      `            cacheHit = countif(${CACHE_HIT}), cacheConsidered = countif(${CACHE_CONSIDERED})`,
      `          by countryName`,
      `| extend _total = toscalar(${this.prefix(f, from, to)} | count)`,
      `| order by requests desc`,
    ].join("\n");
    const rows = await this.run(kql);
    return rows.map((r) => {
      const requests = num(r.requests);
      const iso2 = countryNameToIso2(str(r.countryName));
      return {
        country: iso2,
        countryName: iso2ToCountryName(iso2) || str(r.countryName),
        requests,
        uniqueVisitors: num(r.uniqueVisitors),
        bytes: num(r.bytes),
        errorRate: requests ? num(r.err) / requests : 0,
        cacheHitRatio: num(r.cacheConsidered) ? num(r.cacheHit) / num(r.cacheConsidered) : 0,
        share: num(r._total) ? requests / num(r._total) : 0,
      };
    });
  }

  // ---- paths ----
  async paths(f: Filter, opts: PathExplorerOptions = {}): Promise<{ rows: PathRow[]; total: number }> {
    const { from, to } = resolveTimeRange(f);
    const pe = pathGroupExpr(opts.depth ?? 0);
    const order = PATHS_ORDER[opts.sortBy ?? "requests"] ?? "requests";
    const sortDir = dir(opts.sortDir);
    const limit = clampLimit(opts.limit, 100, 1000);
    const offset = Math.max(0, opts.offset ?? 0);
    const grouped = [
      this.prefix(f, from, to),
      `| extend _p = ${pe}`,
      `| summarize requests = count(), uniqueVisitors = dcount(clientIp),`,
      `            bytes = sum(respBytes), err = countif(statusClass == 4 or statusClass == 5),`,
      `            cacheHit = countif(${CACHE_HIT}), cacheConsidered = countif(${CACHE_CONSIDERED}),`,
      `            s2 = countif(statusClass == 2), s3 = countif(statusClass == 3),`,
      `            s4 = countif(statusClass == 4), s5 = countif(statusClass == 5),`,
      `            avgMs = avg(ms), lastSeen = max(TimeGenerated)`,
      `          by host, path = _p`,
    ].join("\n");
    const kql = [
      grouped,
      `| extend _total = toscalar(${grouped} | count)`,
      `| order by ${order} ${sortDir}`,
      `| serialize`,
      `| extend _rn = row_number()`,
      `| where _rn > ${offset} and _rn <= ${offset + limit}`,
    ].join("\n");
    const [rows, totalRow] = await Promise.all([
      this.run(kql),
      this.run(`${grouped} | count`),
    ]);
    const total = num(totalRow[0]?.Count ?? totalRow[0]?.count);
    return {
      total,
      rows: rows.map((r) => {
        const requests = num(r.requests);
        return {
          host: str(r.host),
          path: str(r.path),
          requests,
          uniqueVisitors: num(r.uniqueVisitors),
          bytes: num(r.bytes),
          errorRate: requests ? num(r.err) / requests : 0,
          cacheHitRatio: num(r.cacheConsidered) ? num(r.cacheHit) / num(r.cacheConsidered) : 0,
          avgLatencyMs: num(r.avgMs),
          status2xx: num(r.s2),
          status3xx: num(r.s3),
          status4xx: num(r.s4),
          status5xx: num(r.s5),
          share: num(r._total) ? requests / num(r._total) : 0,
          lastSeen: new Date(str(r.lastSeen)).toISOString(),
        };
      }),
    };
  }

  // ---- visitors ----
  private async visitorAgg(
    prefix: string,
    opts: VisitorsOptions,
  ): Promise<{ rows: VisitorRow[]; total: number }> {
    const order = VISITOR_ORDER[opts.sortBy ?? "requests"] ?? "requests";
    const sortDir = dir(opts.sortDir);
    const limit = clampLimit(opts.limit, 100, 1000);
    const offset = Math.max(0, opts.offset ?? 0);
    const grouped = [
      prefix,
      `| summarize countryName = any(countryName), city = any(city),`,
      `            requests = count(), bytes = sum(respBytes),`,
      `            distinctPaths = dcount(hostPath),`,
      `            err = countif(statusClass == 4 or statusClass == 5),`,
      `            ja4 = any(ja4), deviceType = any(deviceType),`,
      `            firstSeen = min(TimeGenerated), lastSeen = max(TimeGenerated)`,
      `          by clientIp`,
    ].join("\n");
    const kql = [
      grouped,
      `| order by ${order} ${sortDir}`,
      `| serialize`,
      `| extend _rn = row_number()`,
      `| where _rn > ${offset} and _rn <= ${offset + limit}`,
    ].join("\n");
    const [rows, totalRow] = await Promise.all([
      this.run(kql),
      this.run(`${prefix} | summarize c = dcount(clientIp)`),
    ]);
    const total = num(totalRow[0]?.c);
    return {
      total,
      rows: rows.map((r) => {
        const requests = num(r.requests);
        const iso2 = countryNameToIso2(str(r.countryName));
        return {
          clientIp: str(r.clientIp),
          country: iso2,
          countryName: iso2ToCountryName(iso2) || str(r.countryName),
          city: str(r.city),
          asn: 0,
          asnOrg: "-",
          uaFamily: "",
          deviceType: (str(r.deviceType) || "desktop") as VisitorRow["deviceType"],
          ja4: str(r.ja4),
          requests,
          bytes: num(r.bytes),
          distinctPaths: num(r.distinctPaths),
          errorRate: requests ? num(r.err) / requests : 0,
          firstSeen: new Date(str(r.firstSeen)).toISOString(),
          lastSeen: new Date(str(r.lastSeen)).toISOString(),
        };
      }),
    };
  }

  async visitors(f: Filter, opts: VisitorsOptions = {}): Promise<{ rows: VisitorRow[]; total: number }> {
    const { from, to } = resolveTimeRange(f);
    return this.visitorAgg(this.prefix(f, from, to, { geo: true }), opts);
  }

  async pathVisitors(
    f: Filter,
    host: string,
    path: string,
    opts: VisitorsOptions = {},
  ): Promise<{ rows: VisitorRow[]; total: number }> {
    const { from, to } = resolveTimeRange(f);
    const sub = path.endsWith("/") ? path : path + "/";
    const extra = `| where host == ${kstr(host)} and (path == ${kstr(path)} or path startswith ${kstr(sub)})`;
    return this.visitorAgg(`${this.prefix(f, from, to, { geo: true })}\n${extra}`, opts);
  }

  async visitorDetail(f: Filter, clientIp: string): Promise<VisitorDetail | null> {
    const f2: Filter = { ...f, clientIp: [clientIp] };
    const visitorPage = await this.visitors(f2, { limit: 1 });
    const visitor = visitorPage.rows[0];
    if (!visitor) return null;

    // A few targeted queries (not one per dimension): top paths, pops, UAs,
    // status breakdown, timeline, and a recent-logs page.
    const [topPaths, pops, userAgents, statusRows, timeline, logsPage] = await Promise.all([
      this.topN(f2, { dimension: "path", limit: 15 }),
      this.topN(f2, { dimension: "pop", limit: 10 }),
      this.topN(f2, { dimension: "uaFamily", limit: 10 }),
      this.statusBreakdown(f2),
      this.timeseries(f2),
      this.logs(f2, { limit: 50 }),
    ]);

    return {
      visitor,
      topPaths,
      pops,
      userAgents,
      statusBreakdown: statusRows,
      timeline,
      recent: logsPage.rows,
    };
  }

  private async statusBreakdown(f: Filter): Promise<{ key: StatusClass; requests: number }[]> {
    const { from, to } = resolveTimeRange(f);
    const kql = [
      this.prefix(f, from, to),
      `| summarize requests = count() by statusClass`,
      `| order by requests desc`,
    ].join("\n");
    const rows = await this.run(kql);
    return rows.map((r) => ({
      key: `${num(r.statusClass) || "other"}xx` as StatusClass,
      requests: num(r.requests),
    }));
  }

  // ---- raw logs (timestamp-based cursor) ----
  async logs(f: Filter, opts: LogsOptions = {}): Promise<LogsPage> {
    const { from, to } = resolveTimeRange(f);
    const sortDir = dir(opts.sortDir);
    const limit = clampLimit(opts.limit, 100, 5000);
    // Cursor is the offset row number, encoded as a string (stable within a
    // single sort). Switching data sources resets paging, which is fine.
    const offset = Math.max(0, Math.floor(Number(opts.cursor)) || 0);
    const grouped = this.prefix(f, from, to, { geo: true });
    const kql = [
      grouped,
      `| order by TimeGenerated ${sortDir}`,
      `| serialize`,
      `| extend _rn = row_number()`,
      `| where _rn > ${offset} and _rn <= ${offset + limit}`,
      `| project trackingReference_s, TimeGenerated, httpMethod_s, httpVersion_s,`,
      `          host, path, requestUri_s, statusNum, requestProtocol_s,`,
      `          reqBytes, respBytes, timeTaken_s, timeToFirstByte_s, clientIp, socketIp_s,`,
      `          clientPort_s, countryName, city, latitude, longitude, userAgent,`,
      `          deviceType, ja4, referer, endpoint_s, pop, cacheStatus, routingRuleName_s,`,
      `          securityProtocol, errorInfo, originName_s`,
    ].join("\n");
    const [rows, totalRow] = await Promise.all([
      this.run(kql),
      this.run(`${grouped} | count`),
    ]);
    const total = num(totalRow[0]?.Count ?? totalRow[0]?.count);
    return {
      rows: rows.map((r) => mapRecord(r)),
      total,
      nextCursor: offset + limit < total ? String(offset + limit) : null,
    };
  }

  async facetValues(f: Filter, dimension: Dimension, limit = 50): Promise<TopNRow[]> {
    return this.topN(f, { dimension, limit });
  }

  async proxyChains(f: Filter, limit = 12): Promise<ProxyChains> {
    const { from, to } = resolveTimeRange(f);
    const clamped = clampLimit(limit, 12, 100);
    const prefix = this.prefix(f, from, to);
    // Proxied = the direct peer (SocketIp) differs from the XFF ClientIp. Rank
    // proxied clients by volume; carry the distinct-socket fan-out per client.
    const proxyKql = [
      prefix,
      `| extend socketIp = tostring(socketIp_s)`,
      `| where isnotempty(socketIp) and socketIp != clientIp`,
      `| summarize requests = count(), distinctSockets = dcount(socketIp), socketIp = any(socketIp) by clientIp`,
      `| order by requests desc`,
      `| take ${clamped}`,
    ].join("\n");
    const totalsKql = [
      prefix,
      `| extend socketIp = tostring(socketIp_s)`,
      `| summarize total = count(), proxied = countif(isnotempty(socketIp) and socketIp != clientIp)`,
    ].join("\n");
    const [pairRows, totalRows] = await Promise.all([this.run(proxyKql), this.run(totalsKql)]);
    const t = totalRows[0] ?? {};
    return {
      total: num(t.total),
      proxied: num(t.proxied),
      pairs: pairRows.map((r) => ({
        clientIp: str(r.clientIp),
        socketIp: str(r.socketIp),
        requests: num(r.requests),
        distinctSockets: num(r.distinctSockets),
      })),
    };
  }
}

/** Turn a LogsTable (columns + rows) into an array of name→value objects. */
function rowsOf(table: LogsTable | undefined): Record<string, unknown>[] {
  if (!table) return [];
  const cols = table.columnDescriptors.map((c) => c.name ?? "");
  return table.rows.map((row) => {
    const o: Record<string, unknown> = {};
    row.forEach((v, i) => {
      o[cols[i]] = v;
    });
    return o;
  });
}

const proto = (v: string): AccessLogRecord["protocol"] => {
  const u = v.toUpperCase();
  return u === "HTTPS" || u === "HTTP" || u === "WS" || u === "WSS" ? u : "HTTPS";
};

function mapRecord(r: Record<string, unknown>): AccessLogRecord {
  const iso2 = countryNameToIso2(str(r.countryName));
  const url = str(r.requestUri_s);
  const protocol = proto(str(r.requestProtocol_s));
  return {
    trackingRef: str(r.trackingReference_s),
    timestamp: new Date(str(r.TimeGenerated)).toISOString(),
    method: str(r.httpMethod_s),
    httpVersion: str(r.httpVersion_s),
    scheme: protocol === "HTTPS" || protocol === "WSS" ? "https" : "http",
    host: str(r.host),
    path: str(r.path),
    query: url.includes("?") ? url.slice(url.indexOf("?") + 1) : "",
    url,
    status: num(r.statusNum),
    protocol,
    requestBytes: num(r.reqBytes),
    responseBytes: num(r.respBytes),
    timeTaken: num(r.timeTaken_s),
    timeToFirstByte: num(r.timeToFirstByte_s),
    clientIp: str(r.clientIp),
    socketIp: str(r.socketIp_s),
    clientPort: num(r.clientPort_s),
    country: iso2,
    countryName: iso2ToCountryName(iso2) || str(r.countryName),
    city: str(r.city),
    latitude: num(r.latitude),
    longitude: num(r.longitude),
    asn: 0,
    asnOrg: "-",
    userAgent: str(r.userAgent),
    uaFamily: "",
    uaOs: "",
    deviceType: (str(r.deviceType) || "desktop") as AccessLogRecord["deviceType"],
    ja4: str(r.ja4),
    referer: str(r.referer),
    endpoint: str(r.endpoint_s),
    pop: str(r.pop),
    cacheStatus: (str(r.cacheStatus) || "N/A") as AccessLogRecord["cacheStatus"],
    routeName: str(r.routingRuleName_s),
    ruleSetName: "",
    securityProtocol: str(r.securityProtocol),
    errorInfo: str(r.errorInfo),
    originName: str(r.originName_s),
    originStatus: num(r.statusNum),
  };
}
