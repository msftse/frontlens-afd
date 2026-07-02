import type { AccessLogRecord } from "@/lib/domain/types";
import type {
  WafAction,
  WafEvent,
  WafEventsPage,
  WafSummary,
  WafTimePoint,
  WafTopRow,
} from "@/lib/domain/types";
import type {
  WafDataSource,
  WafDimension,
  WafEventsOptions,
  WafTopOptions,
  TimeseriesOptions,
} from "@/lib/datasource/types";
import type { Filter } from "@/lib/filters/model";
import { resolveTimeRange } from "@/lib/filters/model";

/**
 * Mock WAF surface. Synthesizes deterministic WAF events from the same access
 * records the mock already generates, so Demo mode shows a realistic firewall
 * story (bot blocks, SQLi/LFI anomaly scoring, targeted paths) that stays
 * correlated with the traffic - a request's WAF verdict derives from its own
 * status, user agent and path, and reuses its trackingRef so a WAF event joins
 * back to its access-log row exactly as on real Front Door.
 */

interface MockRule {
  name: string;
  group: string;
  action: WafAction;
  message: string;
}

const BOT_BLOCK: MockRule = {
  name: "Microsoft_BotManagerRuleSet-1.0-BadBots-Bot100200",
  group: "Microsoft_BotManagerRuleSet",
  action: "Block",
  message: "Malicious bots that have falsified their identity",
};
const BOT_UNKNOWN: MockRule = {
  name: "Microsoft_BotManagerRuleSet-1.0-UnknownBots-Bot300600",
  group: "Microsoft_BotManagerRuleSet",
  action: "Log",
  message: "Unknown bots detected by heuristics",
};
const SQLI: MockRule = {
  name: "Microsoft_DefaultRuleSet-2.1-SQLI-942100",
  group: "Microsoft_DefaultRuleSet",
  action: "AnomalyScoring",
  message: "SQL Injection Attack Detected via libinjection",
};
const LFI: MockRule = {
  name: "Microsoft_DefaultRuleSet-2.1-LFI-930130",
  group: "Microsoft_DefaultRuleSet",
  action: "AnomalyScoring",
  message: "Restricted File Access Attempt",
};
const BLOCK_EVAL: MockRule = {
  name: "Microsoft_DefaultRuleSet-2.1-BLOCKING-EVALUATION-949110",
  group: "Microsoft_DefaultRuleSet",
  action: "Block",
  message: "Inbound Anomaly Score Exceeded",
};

/** Stable hash of a string to a unit float in [0,1) for deterministic choices. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * Decide which WAF rules a request triggers (0..n). Deterministic in the
 * record's trackingRef so results are stable across queries.
 */
function rulesFor(r: AccessLogRecord): MockRule[] {
  const out: MockRule[] = [];
  const ua = r.userAgent.toLowerCase();
  const path = r.path.toLowerCase();
  const q = (r.query ?? "").toLowerCase();
  const roll = hash01(r.trackingRef);

  const looksBot = /bot|crawler|spider|curl|wget|python-requests|scan/.test(ua);
  const badBot = /badbot|masscan|nikto|sqlmap|gobuster|(bot.*fake)/.test(ua) || (looksBot && roll < 0.35);
  const sqliish = /('|%27|union|select|or 1=1|;--| or )/.test(q + path);
  const lfiish = /(\.\.\/|\/etc\/passwd|%2e%2e|boot\.ini)/.test(q + path);

  if (badBot) out.push(BOT_BLOCK);
  else if (looksBot) out.push(BOT_UNKNOWN);
  if (sqliish) out.push(SQLI);
  if (lfiish) out.push(LFI);
  // A 403 with an anomaly signal is an enforced block.
  if (r.status === 403 && (sqliish || lfiish || badBot)) out.push(BLOCK_EVAL);
  // A little baseline bot-noise so the WAF timeline is never empty.
  if (out.length === 0 && looksBot && roll > 0.7) out.push(BOT_UNKNOWN);
  return out;
}

/** All WAF events derived from a set of access records (one row per rule match). */
function eventsFrom(records: AccessLogRecord[]): WafEvent[] {
  const events: WafEvent[] = [];
  for (const r of records) {
    const rules = rulesFor(r);
    for (const rule of rules) {
      events.push({
        timestamp: r.timestamp,
        action: rule.action,
        ruleName: rule.name,
        ruleGroup: rule.group,
        clientIp: r.clientIp,
        country: r.countryName,
        host: r.host,
        method: r.method,
        url: r.url,
        message: rule.message,
        policy: "mock-waf-policy",
        trackingRef: r.trackingRef,
      });
    }
  }
  return events;
}

function dimKey(e: WafEvent, d: WafDimension): { key: string; label: string } {
  switch (d) {
    case "ruleName":
      return { key: e.ruleName, label: e.ruleName };
    case "ruleGroup":
      return { key: e.ruleGroup, label: e.ruleGroup };
    case "action":
      return { key: e.action, label: e.action };
    case "clientIp":
      return { key: e.clientIp, label: e.clientIp };
    case "country":
      return { key: e.country, label: e.country };
    case "url": {
      const path = e.url.replace(/^https?:\/\/[^/]+/i, "").split("?")[0] || "/";
      return { key: path, label: path };
    }
    case "message":
      return { key: e.message, label: e.message };
  }
}

function autoBucketSeconds(spanSeconds: number, targetPoints = 150): number {
  const nice = [60, 300, 900, 1800, 3600, 10800, 21600, 43200, 86400, 604800];
  const ideal = spanSeconds / targetPoints;
  for (const b of nice) if (b >= ideal) return b;
  return nice[nice.length - 1];
}

export function createMockWaf(getRecords: (f: Filter) => AccessLogRecord[]): WafDataSource {
  const eventsForFilter = (f: Filter) => eventsFrom(getRecords(f));

  return {
    async summary(f: Filter): Promise<WafSummary> {
      const events = eventsForFilter(f);
      const blocked = events.filter((e) => e.action === "Block").length;
      const logged = events.filter((e) => e.action === "Log").length;
      const scored = events.filter((e) => e.action === "AnomalyScoring").length;
      const total = events.length;
      return {
        total,
        blocked,
        logged,
        scored,
        distinctIps: new Set(events.map((e) => e.clientIp)).size,
        distinctRules: new Set(events.map((e) => e.ruleName)).size,
        blockRate: total ? blocked / total : 0,
      };
    },

    async timeseries(f: Filter, opts: TimeseriesOptions = {}): Promise<WafTimePoint[]> {
      const events = eventsForFilter(f);
      const { from, to } = resolveTimeRange(f);
      const bucketMs =
        (opts.bucketSeconds ?? autoBucketSeconds((to.getTime() - from.getTime()) / 1000)) * 1000;
      const startAligned = Math.floor(from.getTime() / bucketMs) * bucketMs;
      const buckets = new Map<number, WafTimePoint>();
      for (let t = startAligned; t <= to.getTime(); t += bucketMs) {
        buckets.set(t, { t: new Date(t).toISOString(), total: 0, blocked: 0, logged: 0, scored: 0 });
      }
      for (const e of events) {
        const b = Math.floor(Date.parse(e.timestamp) / bucketMs) * bucketMs;
        const p = buckets.get(b);
        if (!p) continue;
        p.total++;
        if (e.action === "Block") p.blocked++;
        else if (e.action === "Log") p.logged++;
        else if (e.action === "AnomalyScoring") p.scored++;
      }
      return [...buckets.values()];
    },

    async topN(f: Filter, opts: WafTopOptions): Promise<WafTopRow[]> {
      let events = eventsForFilter(f);
      if (opts.action) events = events.filter((e) => e.action === opts.action);
      const total = events.length;
      const limit = Math.max(1, Math.min(1000, opts.limit ?? 12));
      const agg = new Map<string, { label: string; count: number; blocked: number }>();
      for (const e of events) {
        const { key, label } = dimKey(e, opts.dimension);
        let a = agg.get(key);
        if (!a) {
          a = { label, count: 0, blocked: 0 };
          agg.set(key, a);
        }
        a.count++;
        if (e.action === "Block") a.blocked++;
      }
      return [...agg.entries()]
        .map(([key, a]) => ({
          key,
          label: a.label,
          count: a.count,
          blocked: a.blocked,
          share: total ? a.count / total : 0,
        }))
        .sort((x, y) => y.count - x.count)
        .slice(0, limit);
    },

    async events(f: Filter, opts: WafEventsOptions = {}): Promise<WafEventsPage> {
      let events = eventsForFilter(f);
      if (opts.action) events = events.filter((e) => e.action === opts.action);
      const dir = opts.sortDir ?? "desc";
      events.sort((a, b) =>
        dir === "asc"
          ? a.timestamp.localeCompare(b.timestamp)
          : b.timestamp.localeCompare(a.timestamp),
      );
      const limit = Math.max(1, Math.min(2000, opts.limit ?? 100));
      const start = opts.cursor ? Number(opts.cursor) : 0;
      const page = events.slice(start, start + limit);
      const next = start + limit < events.length ? String(start + limit) : null;
      return { rows: page, total: events.length, nextCursor: next };
    },
  };
}

/** Exposed for unit tests: derive WAF events from access records. */
export const __testables = { eventsFrom, rulesFor };
