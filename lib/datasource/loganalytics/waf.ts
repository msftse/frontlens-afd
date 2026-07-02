import type { Filter } from "@/lib/filters/model";
import { resolveTimeRange } from "@/lib/filters/model";
import type {
  WafEventsOptions,
  WafDataSource,
  WafTopOptions,
  WafDimension,
} from "@/lib/datasource/types";
import type {
  WafAction,
  WafEvent,
  WafEventsPage,
  WafSummary,
  WafTimePoint,
  WafTopRow,
} from "@/lib/domain/types";
import { autoBucketSeconds, kstr, timeConditions } from "@/lib/datasource/loganalytics/kql";
import { iso2ToCountryNames } from "@/lib/datasource/loganalytics/countries";

/**
 * Live WAF data source over Azure Front Door's
 * `FrontDoorWebApplicationFirewallLog` category (same workspace as access
 * logs). Verified against live AFD WAF data: action (Block/Log/AnomalyScoring),
 * ruleName, clientIP, requestUri, details_msg and trackingReference are all
 * real fields; trackingReference joins a WAF event back to its access-log row.
 *
 * Runs KQL via the `run` function the parent Log Analytics adapter injects, so
 * it shares the workspace client, credentials and error handling.
 */

const WAF_CATEGORY = "FrontDoorWebApplicationFirewallLog";
const TABLE = "AzureDiagnostics";

type Runner = (kql: string) => Promise<Record<string, unknown>[]>;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v == null ? "" : String(v));

/** Normalize the raw WAF columns to clean names the queries reference. */
function wafProjection(): string {
  return [
    "| extend",
    "    action = tostring(action_s),",
    "    ruleName = tostring(ruleName_s),",
    "    clientIp = tostring(clientIP_s),",
    "    host = tostring(host_s),",
    "    countryName = tostring(clientCountry_s),",
    "    url = tostring(requestUri_s),",
    "    message = tostring(details_msg_s),",
    "    policy = tostring(policy_s),",
    "    method = tostring(httpMethod_s),",
    "    trackingRef = tostring(trackingReference_s)",
    // Rule group is the leading token of the managed-rule name
    // (e.g. Microsoft_BotManagerRuleSet, Microsoft_DefaultRuleSet).
    "| extend ruleGroup = tostring(split(ruleName, '-')[0])",
    "| extend path = tostring(parse_url(url).Path)",
  ].join("\n");
}

/** WAF facet predicates - the subset of the shared Filter that maps to WAF fields. */
function wafFacets(f: Filter): string[] {
  const c: string[] = [];
  const inList = (col: string, values: readonly string[]) => {
    if (values.length) c.push(`${col} in (${values.map((v) => kstr(v)).join(", ")})`);
  };
  inList("host", f.host);
  inList("clientIp", f.clientIp);
  if (f.country.length) {
    const names = f.country.flatMap((iso) => iso2ToCountryNames(iso));
    c.push(`countryName in (${names.map((v) => kstr(v)).join(", ")})`);
  }
  if (f.q) {
    const fields = `strcat(url, " ", clientIp, " ", ruleName, " ", message)`;
    c.push(`${fields} contains ${kstr(f.q)}`);
  }
  return c;
}

/** Common prefix: table + category + time bound, projection, then WAF facets. */
function wafPrefix(f: Filter, from: Date, to: Date): string {
  const facets = wafFacets(f);
  return [
    TABLE,
    `| where Category == ${kstr(WAF_CATEGORY)}`,
    `| where ${timeConditions(from, to).join("\n    and ")}`,
    wafProjection(),
    facets.length ? `| where ${facets.join("\n    and ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** KQL key/label expression for a WAF dimension. */
function wafDimExpr(d: WafDimension): { key: string; label: string } {
  switch (d) {
    case "ruleName":
      return { key: "ruleName", label: "ruleName" };
    case "ruleGroup":
      return { key: "ruleGroup", label: "ruleGroup" };
    case "action":
      return { key: "action", label: "action" };
    case "clientIp":
      return { key: "clientIp", label: "clientIp" };
    case "country":
      return { key: "countryName", label: "countryName" };
    case "url":
      return { key: "path", label: "path" };
    case "message":
      return { key: "message", label: "message" };
  }
}

const KNOWN_ACTIONS: ReadonlySet<string> = new Set([
  "Block",
  "Log",
  "AnomalyScoring",
  "Allow",
  "JSChallenge",
  "Redirect",
]);
function asAction(v: unknown): WafAction {
  const s = str(v);
  return (KNOWN_ACTIONS.has(s) ? s : "Log") as WafAction;
}

export function createLogAnalyticsWaf(run: Runner): WafDataSource {
  return {
    async summary(f: Filter): Promise<WafSummary> {
      const { from, to } = resolveTimeRange(f);
      const span = to.getTime() - from.getTime();
      const prevFrom = new Date(from.getTime() - span);

      // Current + previous window in one query via a computed window flag.
      const kql = [
        TABLE,
        `| where Category == ${kstr(WAF_CATEGORY)}`,
        `| where TimeGenerated >= datetime(${prevFrom.toISOString()}) and TimeGenerated <= datetime(${to.toISOString()})`,
        wafProjection(),
        wafFacets(f).length ? `| where ${wafFacets(f).join("\n    and ")}` : "",
        `| extend _win = iff(TimeGenerated >= datetime(${from.toISOString()}), "cur", "prev")`,
        `| summarize total = count(),`,
        `            blocked = countif(action == "Block"),`,
        `            logged = countif(action == "Log"),`,
        `            scored = countif(action == "AnomalyScoring"),`,
        `            distinctIps = dcount(clientIp),`,
        `            distinctRules = dcount(ruleName)`,
        `          by _win`,
      ].join("\n");
      const rows = await run(kql);
      const cur = rows.find((r) => r._win === "cur") ?? {};
      const prev = rows.find((r) => r._win === "prev");

      const total = num(cur.total);
      const blocked = num(cur.blocked);
      const blockRate = total ? blocked / total : 0;

      let delta: WafSummary["delta"];
      if (prev) {
        const ratio = (c: number, p: number) => (p > 0 ? c / p - 1 : undefined);
        const pTotal = num(prev.total);
        const pBlocked = num(prev.blocked);
        const pRate = pTotal ? pBlocked / pTotal : 0;
        delta = {
          total: ratio(total, pTotal),
          blocked: ratio(blocked, pBlocked),
          logged: ratio(num(cur.logged), num(prev.logged)),
          scored: ratio(num(cur.scored), num(prev.scored)),
          blockRate: pRate > 0 ? blockRate / pRate - 1 : undefined,
        };
      }

      return {
        total,
        blocked,
        logged: num(cur.logged),
        scored: num(cur.scored),
        distinctIps: num(cur.distinctIps),
        distinctRules: num(cur.distinctRules),
        blockRate,
        delta,
      };
    },

    async timeseries(f: Filter, opts = {}): Promise<WafTimePoint[]> {
      const { from, to } = resolveTimeRange(f);
      const bucket = Math.max(
        1,
        Math.floor(opts.bucketSeconds ?? autoBucketSeconds((to.getTime() - from.getTime()) / 1000)),
      );
      const kql = [
        wafPrefix(f, from, to),
        `| summarize total = count(),`,
        `            blocked = countif(action == "Block"),`,
        `            logged = countif(action == "Log"),`,
        `            scored = countif(action == "AnomalyScoring")`,
        `          by t = bin(TimeGenerated, ${bucket}s)`,
        `| order by t asc`,
      ].join("\n");
      const rows = await run(kql);
      return rows.map((r) => ({
        t: new Date(str(r.t)).toISOString(),
        total: num(r.total),
        blocked: num(r.blocked),
        logged: num(r.logged),
        scored: num(r.scored),
      }));
    },

    async topN(f: Filter, opts: WafTopOptions): Promise<WafTopRow[]> {
      const { from, to } = resolveTimeRange(f);
      const limit = Math.max(1, Math.min(1000, opts.limit ?? 12));
      const { key, label } = wafDimExpr(opts.dimension);
      const actionFilter =
        opts.action && KNOWN_ACTIONS.has(opts.action) ? `| where action == ${kstr(opts.action)}` : "";
      const prefix = wafPrefix(f, from, to);
      const kql = [
        prefix,
        actionFilter,
        `| extend _k = ${key}, _label = ${label}`,
        `| summarize count = count(), blocked = countif(action == "Block") by _k, _label`,
        `| extend _total = toscalar(${prefix} ${actionFilter} | count)`,
        `| order by count desc`,
        `| take ${limit}`,
      ].join("\n");
      const rows = await run(kql);
      return rows.map((r) => {
        const total = num(r._total);
        return {
          key: str(r._k),
          label: str(r._label ?? r._k),
          count: num(r.count),
          blocked: num(r.blocked),
          share: total ? num(r.count) / total : 0,
        };
      });
    },

    async events(f: Filter, opts: WafEventsOptions = {}): Promise<WafEventsPage> {
      const { from, to } = resolveTimeRange(f);
      const limit = Math.max(1, Math.min(2000, opts.limit ?? 100));
      const offset = Math.max(0, Math.floor(Number(opts.cursor)) || 0);
      const sortDir = opts.sortDir === "asc" ? "asc" : "desc";
      const actionFilter =
        opts.action && KNOWN_ACTIONS.has(opts.action) ? `| where action == ${kstr(opts.action)}` : "";
      const prefix = wafPrefix(f, from, to);
      const grouped = [prefix, actionFilter].filter(Boolean).join("\n");
      const kql = [
        grouped,
        `| order by TimeGenerated ${sortDir}`,
        `| serialize`,
        `| extend _rn = row_number()`,
        `| where _rn > ${offset} and _rn <= ${offset + limit}`,
        `| project TimeGenerated, action, ruleName, ruleGroup, clientIp, countryName,`,
        `          host, method, url, message, policy, trackingRef`,
      ].join("\n");
      const [rows, totalRow] = await Promise.all([run(kql), run(`${grouped} | count`)]);
      const total = num(totalRow[0]?.Count ?? totalRow[0]?.count);
      return {
        total,
        nextCursor: offset + limit < total ? String(offset + limit) : null,
        rows: rows.map(
          (r): WafEvent => ({
            timestamp: new Date(str(r.TimeGenerated)).toISOString(),
            action: asAction(r.action),
            ruleName: str(r.ruleName),
            ruleGroup: str(r.ruleGroup),
            clientIp: str(r.clientIp),
            country: str(r.countryName),
            host: str(r.host),
            method: str(r.method),
            url: str(r.url),
            message: str(r.message),
            policy: str(r.policy),
            trackingRef: str(r.trackingRef),
          }),
        ),
      };
    },
  };
}
