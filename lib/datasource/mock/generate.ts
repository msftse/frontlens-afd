import type { AccessLogRecord, CacheStatus, DeviceType } from "@/lib/domain/types";
import {
  ASNS,
  COUNTRIES,
  HOSTS,
  POPS_BY_REGION,
  SECURITY_PROTOCOLS,
  USER_AGENTS,
  type AsnDef,
  type CountryDef,
  type HostDef,
  type PathDef,
  type Region,
  type UaDef,
} from "@/lib/datasource/mock/catalog";

// ---- deterministic RNG (mulberry32) ----
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeWeightedPicker<T>(items: T[], weightOf: (t: T) => number) {
  const cum: number[] = [];
  let total = 0;
  for (const it of items) {
    total += Math.max(0, weightOf(it));
    cum.push(total);
  }
  return (rnd: number): T => {
    const x = rnd * total;
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (x <= cum[mid]) hi = mid;
      else lo = mid + 1;
    }
    return items[lo];
  };
}

function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Log-normal-ish positive value around `mean` with given spread. */
function noisyBytes(mean: number, rng: () => number): number {
  const factor = Math.exp(gaussian(rng) * 0.45);
  return Math.max(64, Math.round(mean * factor));
}

const IP_PREFIXES = [12, 24, 31, 45, 51, 77, 82, 88, 99, 103, 151, 176, 185, 196, 203, 212];

interface Visitor {
  clientIp: string;
  socketIp: string;
  country: CountryDef;
  city: { name: string; lat: number; lon: number };
  lat: number;
  lon: number;
  asn: AsnDef;
  ua: UaDef;
  region: Region;
  activity: number; // relative request volume
  homeHost: HostDef;
}

export interface MockDataset {
  records: AccessLogRecord[];
  visitors: number;
  generatedAt: string;
  spanDays: number;
}

export interface GenerateOptions {
  seed?: number;
  records?: number;
  visitors?: number;
  spanDays?: number;
  now?: number;
}

function buildVisitorPool(rng: () => number, count: number): Visitor[] {
  const pickCountry = makeWeightedPicker(COUNTRIES, (c) => c.weight);
  const pickIsp = makeWeightedPicker(
    ASNS.filter((a) => a.kind !== "datacenter"),
    () => 1,
  );
  const pickDc = makeWeightedPicker(
    ASNS.filter((a) => a.kind === "datacenter"),
    () => 1,
  );
  const pickUa = makeWeightedPicker(USER_AGENTS, (u) => u.weight);
  const pickHost = makeWeightedPicker(HOSTS, (h) => h.weight);

  const visitors: Visitor[] = [];
  for (let i = 0; i < count; i++) {
    const country = pickCountry(rng());
    const city = country.cities[Math.floor(rng() * country.cities.length)];
    const ua = pickUa(rng());
    const isBot = ua.device === "bot";
    const asn = isBot ? pickDc(rng()) : pickIsp(rng());
    const prefix = IP_PREFIXES[Math.floor(rng() * IP_PREFIXES.length)];
    const clientIp = `${prefix}.${Math.floor(rng() * 256)}.${Math.floor(rng() * 256)}.${1 + Math.floor(rng() * 254)}`;
    // ~12% of clients sit behind a proxy/corporate egress, so the edge sees a
    // SocketIp (the direct peer) that differs from the XFF ClientIp. Real AFD
    // exposes both; this makes proxy-chain analysis meaningful on demo data too.
    const proxied = rng() < 0.12;
    const socketIp = proxied
      ? `${prefix}.${Math.floor(rng() * 256)}.${Math.floor(rng() * 256)}.${1 + Math.floor(rng() * 254)}`
      : clientIp;
    // Pareto-ish activity: a few very heavy users, long tail of light ones.
    const activity = Math.pow(rng(), 2.2) * 9 + 0.15;
    visitors.push({
      clientIp,
      socketIp,
      country,
      city,
      lat: city.lat + gaussian(rng) * 0.15,
      lon: city.lon + gaussian(rng) * 0.15,
      asn,
      ua,
      region: country.region,
      activity: isBot ? activity * 1.7 : activity,
      homeHost: pickHost(rng()),
    });
  }
  return visitors;
}

/** Build a per-hour weight curve with recency growth + diurnal + weekly cycles. */
function buildHourlyCdf(spanHours: number, startDow: number): { cum: number[]; total: number } {
  const cum: number[] = new Array(spanHours);
  let total = 0;
  for (let i = 0; i < spanHours; i++) {
    const frac = i / spanHours;
    const growth = 0.25 + Math.pow(frac, 1.4) * 3.2; // traffic grows toward "now"
    const hod = i % 24;
    const diurnal = 0.45 + 0.55 * Math.max(0, Math.sin(((hod - 6) / 24) * 2 * Math.PI));
    const dow = (startDow + Math.floor(i / 24)) % 7;
    const weekly = dow === 0 || dow === 6 ? 0.68 : 1;
    total += growth * diurnal * weekly;
    cum[i] = total;
  }
  return { cum, total };
}

function sampleHour(cum: number[], total: number, rnd: number): number {
  const x = rnd * total;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x <= cum[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function pickStatus(path: PathDef, isWrite: boolean, rng: () => number): number {
  const bias = path.errorBias ?? 1;
  const roll = rng();
  // Auth/login paths produce more 401/403.
  const authy = /login|auth/.test(path.path);
  const p5xx = 0.006 * bias;
  const p4xx = (authy ? 0.06 : 0.018) * bias;
  const p3xx = path.cacheable && !isWrite ? 0.08 : 0.01;
  if (roll < p5xx) {
    const codes = [500, 502, 503, 504, 0];
    return codes[Math.floor(rng() * codes.length)];
  }
  if (roll < p5xx + p4xx) {
    if (authy) return rng() < 0.7 ? 401 : 403;
    const codes = [404, 400, 403, 429];
    return codes[Math.floor(rng() * codes.length)];
  }
  if (roll < p5xx + p4xx + p3xx) return rng() < 0.8 ? 304 : 302;
  return isWrite ? 201 : 200;
}

function pickCacheStatus(path: PathDef, status: number, isWrite: boolean, rng: () => number): CacheStatus {
  if (status >= 400 || status === 0) return "N/A";
  if (isWrite) return "PRIVATE_NOSTORE";
  if (!path.cacheable) return rng() < 0.5 ? "CACHE_NOCONFIG" : "PRIVATE_NOSTORE";
  if (status === 304) return "HIT";
  const r = rng();
  if (r < 0.62) return "HIT";
  if (r < 0.72) return "REMOTE_HIT";
  if (r < 0.78) return "PARTIAL_HIT";
  return "MISS";
}

function errorInfoFor(status: number): string {
  if (status === 0) return "OriginTimeout";
  if (status === 504) return "OriginTimeout";
  if (status === 502) return "OriginConnectionError";
  if (status === 503) return "OriginError";
  if (status === 500) return "OriginInvalidResponse";
  return "NoError";
}

const REFERERS = [
  "",
  "",
  "",
  "https://www.google.com/",
  "https://www.google.com/",
  "https://t.co/",
  "https://www.bing.com/",
  "https://news.ycombinator.com/",
  "https://www.reddit.com/",
];

function hex(rng: () => number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += Math.floor(rng() * 16).toString(16);
  return s.toUpperCase();
}

export function generateDataset(opts: GenerateOptions = {}): MockDataset {
  const seed = opts.seed ?? 1337;
  const spanDays = opts.spanDays ?? 90;
  const numRecords = opts.records ?? 120_000;
  const numVisitors = opts.visitors ?? 1_200;
  const now = opts.now ?? Date.now();
  const rng = mulberry32(seed);

  const visitors = buildVisitorPool(rng, numVisitors);
  const pickVisitor = makeWeightedPicker(visitors, (v) => v.activity);

  const spanHours = spanDays * 24;
  const startMs = now - spanHours * 3600_000;
  const startDow = new Date(startMs).getUTCDay();
  const { cum, total } = buildHourlyCdf(spanHours, startDow);

  const records: AccessLogRecord[] = new Array(numRecords);

  for (let i = 0; i < numRecords; i++) {
    const v = pickVisitor(rng());

    // Host: 60% the visitor's home host, else weighted global.
    const host: HostDef =
      rng() < 0.6 ? v.homeHost : HOSTS[Math.floor(rng() * HOSTS.length)];
    const pickPath = makeWeightedPicker(host.paths, (p) => p.weight);
    const path = pickPath(rng());

    const isWrite =
      /login|auth|orders/.test(path.path) && rng() < 0.55
        ? true
        : !path.cacheable && rng() < 0.12;
    const method = isWrite
      ? rng() < 0.8
        ? "POST"
        : rng() < 0.5
          ? "PUT"
          : "DELETE"
      : rng() < 0.97
        ? "GET"
        : "HEAD";

    const status = pickStatus(path, isWrite, rng);
    const cacheStatus = pickCacheStatus(path, status, isWrite, rng);
    const cacheHit = cacheStatus === "HIT" || cacheStatus === "REMOTE_HIT";

    const hour = sampleHour(cum, total, rng());
    const ts = startMs + hour * 3600_000 + Math.floor(rng() * 3600_000);

    const responseBytes =
      status === 304 || status >= 400 ? noisyBytes(400, rng) : noisyBytes(path.bytes, rng);
    const requestBytes = noisyBytes(isWrite ? 1400 : 380, rng);

    // Latency: cache hits are fast; origin/dynamic slower; errors variable.
    const base = cacheHit ? 0.012 : path.cacheable ? 0.045 : 0.09;
    const errPenalty = status >= 500 ? 0.6 : status === 0 ? 30 : 0;
    const ttfb = Math.max(0.003, base + Math.abs(gaussian(rng)) * base * 0.8 + errPenalty);
    const timeTaken = ttfb + Math.abs(gaussian(rng)) * 0.02 + responseBytes / 6_000_000;

    // PoP: usually visitor's region, sometimes neighboring.
    const regionPops = POPS_BY_REGION[v.region];
    const pop =
      rng() < 0.88
        ? regionPops[Math.floor(rng() * regionPops.length)]
        : (() => {
            const regions = Object.keys(POPS_BY_REGION) as Region[];
            const rr = regions[Math.floor(rng() * regions.length)];
            const list = POPS_BY_REGION[rr];
            return list[Math.floor(rng() * list.length)];
          })();

    const scheme: "http" | "https" = rng() < 0.992 ? "https" : "http";
    const query =
      path.path.startsWith("/api") && rng() < 0.5
        ? `ticker=${["AAPL", "TSLA", "NVDA", "MSFT", "AMZN"][Math.floor(rng() * 5)]}`
        : "";
    const url = `${scheme}://${host.host}${path.path}${query ? `?${query}` : ""}`;
    const deviceType: DeviceType = v.ua.device;

    records[i] = {
      trackingRef: `0${hex(rng, 7)}-${hex(rng, 4)}-${hex(rng, 12)}`,
      timestamp: new Date(ts).toISOString(),
      method,
      httpVersion: scheme === "https" ? "2.0" : "1.1",
      scheme,
      host: host.host,
      path: path.path,
      query,
      url,
      status,
      protocol: scheme === "https" ? "HTTPS" : "HTTP",
      requestBytes,
      responseBytes,
      timeTaken: Number(timeTaken.toFixed(4)),
      timeToFirstByte: Number(ttfb.toFixed(4)),
      clientIp: v.clientIp,
      socketIp: v.socketIp,
      clientPort: 1024 + Math.floor(rng() * 64000),
      country: v.country.iso2,
      countryName: v.country.name,
      city: v.city.name,
      latitude: Number(v.lat.toFixed(4)),
      longitude: Number(v.lon.toFixed(4)),
      asn: v.asn.asn,
      asnOrg: v.asn.org,
      userAgent: v.ua.ua,
      uaFamily: v.ua.family,
      uaOs: v.ua.os,
      deviceType,
      ja4: v.ua.ja4,
      referer: REFERERS[Math.floor(rng() * REFERERS.length)],
      endpoint: host.endpoint,
      pop,
      cacheStatus,
      routeName: host.routeName,
      ruleSetName: rng() < 0.25 ? "default-ruleset" : "",
      securityProtocol: SECURITY_PROTOCOLS[rng() < 0.7 ? 1 : 0],
      errorInfo: errorInfoFor(status),
      originName: cacheHit ? "N/A" : host.origin,
      originStatus: cacheHit ? 0 : status,
    };
  }

  records.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return {
    records,
    visitors: numVisitors,
    generatedAt: new Date(now).toISOString(),
    spanDays,
  };
}
