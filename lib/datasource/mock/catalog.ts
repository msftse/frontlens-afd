/**
 * Reference data for the synthetic generator. Modeled on a realistic multi-host
 * AFD profile so the UI demos convincingly: weighted countries with real-ish
 * cities/coords, ASN orgs, edge PoPs by region, a path catalog with
 * cacheability, and a UA pool with JA4 fingerprints.
 */

export interface CountryDef {
  iso2: string;
  name: string;
  region: Region;
  weight: number;
  cities: { name: string; lat: number; lon: number }[];
}

export type Region = "NA" | "EU" | "AS" | "OC" | "SA" | "AF" | "ME";

export const COUNTRIES: CountryDef[] = [
  { iso2: "US", name: "United States", region: "NA", weight: 30, cities: [
    { name: "New York", lat: 40.71, lon: -74.0 },
    { name: "San Francisco", lat: 37.77, lon: -122.42 },
    { name: "Chicago", lat: 41.88, lon: -87.63 },
    { name: "Dallas", lat: 32.78, lon: -96.8 },
    { name: "Seattle", lat: 47.61, lon: -122.33 },
  ] },
  { iso2: "IL", name: "Israel", region: "ME", weight: 9, cities: [
    { name: "Tel Aviv", lat: 32.08, lon: 34.78 },
    { name: "Jerusalem", lat: 31.77, lon: 35.21 },
    { name: "Haifa", lat: 32.79, lon: 34.99 },
  ] },
  { iso2: "GB", name: "United Kingdom", region: "EU", weight: 10, cities: [
    { name: "London", lat: 51.51, lon: -0.13 },
    { name: "Manchester", lat: 53.48, lon: -2.24 },
  ] },
  { iso2: "IN", name: "India", region: "AS", weight: 9, cities: [
    { name: "Mumbai", lat: 19.08, lon: 72.88 },
    { name: "Bengaluru", lat: 12.97, lon: 77.59 },
    { name: "Delhi", lat: 28.61, lon: 77.21 },
  ] },
  { iso2: "DE", name: "Germany", region: "EU", weight: 8, cities: [
    { name: "Frankfurt", lat: 50.11, lon: 8.68 },
    { name: "Berlin", lat: 52.52, lon: 13.4 },
  ] },
  { iso2: "CA", name: "Canada", region: "NA", weight: 5, cities: [
    { name: "Toronto", lat: 43.65, lon: -79.38 },
    { name: "Vancouver", lat: 49.28, lon: -123.12 },
  ] },
  { iso2: "FR", name: "France", region: "EU", weight: 6, cities: [
    { name: "Paris", lat: 48.86, lon: 2.35 },
  ] },
  { iso2: "JP", name: "Japan", region: "AS", weight: 5, cities: [
    { name: "Tokyo", lat: 35.68, lon: 139.69 },
    { name: "Osaka", lat: 34.69, lon: 135.5 },
  ] },
  { iso2: "AU", name: "Australia", region: "OC", weight: 4, cities: [
    { name: "Sydney", lat: -33.87, lon: 151.21 },
    { name: "Melbourne", lat: -37.81, lon: 144.96 },
  ] },
  { iso2: "BR", name: "Brazil", region: "SA", weight: 4, cities: [
    { name: "São Paulo", lat: -23.55, lon: -46.63 },
  ] },
  { iso2: "NL", name: "Netherlands", region: "EU", weight: 3, cities: [
    { name: "Amsterdam", lat: 52.37, lon: 4.9 },
  ] },
  { iso2: "SG", name: "Singapore", region: "AS", weight: 3, cities: [
    { name: "Singapore", lat: 1.35, lon: 103.82 },
  ] },
  { iso2: "ES", name: "Spain", region: "EU", weight: 3, cities: [
    { name: "Madrid", lat: 40.42, lon: -3.7 },
  ] },
  { iso2: "IT", name: "Italy", region: "EU", weight: 3, cities: [
    { name: "Milan", lat: 45.46, lon: 9.19 },
  ] },
  { iso2: "AE", name: "United Arab Emirates", region: "ME", weight: 2, cities: [
    { name: "Dubai", lat: 25.2, lon: 55.27 },
  ] },
  { iso2: "KR", name: "South Korea", region: "AS", weight: 2, cities: [
    { name: "Seoul", lat: 37.57, lon: 126.98 },
  ] },
  { iso2: "MX", name: "Mexico", region: "NA", weight: 2, cities: [
    { name: "Mexico City", lat: 19.43, lon: -99.13 },
  ] },
  { iso2: "ZA", name: "South Africa", region: "AF", weight: 2, cities: [
    { name: "Johannesburg", lat: -26.2, lon: 28.05 },
  ] },
  { iso2: "SE", name: "Sweden", region: "EU", weight: 2, cities: [
    { name: "Stockholm", lat: 59.33, lon: 18.06 },
  ] },
  { iso2: "PL", name: "Poland", region: "EU", weight: 2, cities: [
    { name: "Warsaw", lat: 52.23, lon: 21.01 },
  ] },
];

/** Edge PoP codes grouped by region (matches AFD-style 3-letter codes). */
export const POPS_BY_REGION: Record<Region, string[]> = {
  NA: ["LAX", "SJC", "SEA", "DFW", "ORD", "IAD", "ATL", "MIA", "YYZ"],
  EU: ["LHR", "AMS", "FRA", "CDG", "MAD", "ARN", "MXP", "DUB", "WAW"],
  AS: ["SIN", "HKG", "NRT", "ICN", "BOM", "DEL", "KIX"],
  OC: ["SYD", "MEL", "AKL"],
  SA: ["GRU", "EZE", "SCL", "BOG"],
  AF: ["JNB", "CPT", "LOS", "NBO"],
  ME: ["DXB", "TLV", "FUJ"],
};

export interface AsnDef {
  asn: number;
  org: string;
  kind: "isp" | "mobile" | "datacenter";
}

export const ASNS: AsnDef[] = [
  { asn: 7922, org: "Comcast Cable", kind: "isp" },
  { asn: 7018, org: "AT&T Internet", kind: "isp" },
  { asn: 701, org: "Verizon Business", kind: "isp" },
  { asn: 20115, org: "Charter Spectrum", kind: "isp" },
  { asn: 3320, org: "Deutsche Telekom", kind: "isp" },
  { asn: 5089, org: "Virgin Media", kind: "isp" },
  { asn: 3215, org: "Orange France", kind: "isp" },
  { asn: 8551, org: "Bezeq International", kind: "isp" },
  { asn: 12849, org: "Hot Mobile", kind: "mobile" },
  { asn: 12400, org: "Partner Communications", kind: "mobile" },
  { asn: 55836, org: "Reliance Jio", kind: "mobile" },
  { asn: 9498, org: "Bharti Airtel", kind: "mobile" },
  { asn: 4713, org: "NTT Communications", kind: "isp" },
  { asn: 9318, org: "SK Broadband", kind: "isp" },
  { asn: 1221, org: "Telstra", kind: "isp" },
  { asn: 16509, org: "Amazon AWS", kind: "datacenter" },
  { asn: 15169, org: "Google Cloud", kind: "datacenter" },
  { asn: 8075, org: "Microsoft Azure", kind: "datacenter" },
  { asn: 14061, org: "DigitalOcean", kind: "datacenter" },
  { asn: 24940, org: "Hetzner Online", kind: "datacenter" },
];

export interface UaDef {
  ua: string;
  family: string;
  os: string;
  device: "desktop" | "mobile" | "tablet" | "bot";
  ja4: string;
  weight: number;
}

export const USER_AGENTS: UaDef[] = [
  { family: "Chrome", os: "Windows", device: "desktop", weight: 26, ja4: "t13d1516h2_8daaf6152771_b186095e22b6",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" },
  { family: "Chrome", os: "macOS", device: "desktop", weight: 12, ja4: "t13d1516h2_8daaf6152771_b0da82dd1658",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" },
  { family: "Safari", os: "macOS", device: "desktop", weight: 8, ja4: "t13d2014h2_a09f3c656075_14788d8d241b",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15" },
  { family: "Safari", os: "iOS", device: "mobile", weight: 16, ja4: "t13d2014h2_a09f3c656075_3d5a1b2c9e44",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1" },
  { family: "Chrome", os: "Android", device: "mobile", weight: 14, ja4: "t13d1516h2_8daaf6152771_aa1f7b6c2d33",
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36" },
  { family: "Firefox", os: "Windows", device: "desktop", weight: 5, ja4: "t13d1715h2_5b57614c22b0_93c746dc1efd",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0" },
  { family: "Edge", os: "Windows", device: "desktop", weight: 6, ja4: "t13d1516h2_8daaf6152771_e3b0c44298fc",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0" },
  { family: "Safari", os: "iPadOS", device: "tablet", weight: 3, ja4: "t13d2014h2_a09f3c656075_7c91a0f4b2e1",
    ua: "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1" },
  { family: "Googlebot", os: "—", device: "bot", weight: 3, ja4: "t13d301000_c34a54f7b9d2_000000000000",
    ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
  { family: "bingbot", os: "—", device: "bot", weight: 2, ja4: "t13d301000_c34a54f7b9d2_111111111111",
    ua: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)" },
  { family: "curl", os: "—", device: "bot", weight: 2, ja4: "t13d000000_000000000000_222222222222",
    ua: "curl/8.5.0" },
  { family: "python-requests", os: "—", device: "bot", weight: 2, ja4: "t13d000000_000000000000_333333333333",
    ua: "python-requests/2.31.0" },
];

export interface PathDef {
  path: string;
  weight: number;
  cacheable: boolean;
  /** Typical response size in bytes (mean). */
  bytes: number;
  /** Base error propensity multiplier (1 = normal). */
  errorBias?: number;
}

export interface HostDef {
  host: string;
  endpoint: string;
  origin: string;
  routeName: string;
  weight: number;
  paths: PathDef[];
}

const apiPaths: PathDef[] = [
  { path: "/api/v1/quote", weight: 30, cacheable: false, bytes: 2400 },
  { path: "/api/v1/portfolio", weight: 14, cacheable: false, bytes: 8200 },
  { path: "/api/v1/analysts", weight: 12, cacheable: false, bytes: 14000 },
  { path: "/api/v1/news", weight: 10, cacheable: true, bytes: 9000 },
  { path: "/api/v1/screener", weight: 8, cacheable: false, bytes: 22000, errorBias: 1.6 },
  { path: "/api/v2/insiders", weight: 6, cacheable: false, bytes: 11000 },
  { path: "/api/v1/auth/login", weight: 5, cacheable: false, bytes: 600, errorBias: 3 },
  { path: "/api/health", weight: 4, cacheable: false, bytes: 120 },
];

export const HOSTS: HostDef[] = [
  {
    host: "www.contoso.com",
    endpoint: "contoso-prod.z01.azurefd.net",
    origin: "contoso-web-eastus",
    routeName: "web-route",
    weight: 34,
    paths: [
      { path: "/", weight: 20, cacheable: true, bytes: 42000 },
      { path: "/stocks/AAPL", weight: 10, cacheable: true, bytes: 68000 },
      { path: "/stocks/TSLA", weight: 9, cacheable: true, bytes: 66000 },
      { path: "/stocks/NVDA", weight: 9, cacheable: true, bytes: 67000 },
      { path: "/analysts", weight: 7, cacheable: true, bytes: 52000 },
      { path: "/portfolio", weight: 7, cacheable: false, bytes: 38000 },
      { path: "/news", weight: 6, cacheable: true, bytes: 48000 },
      { path: "/login", weight: 6, cacheable: false, bytes: 12000, errorBias: 2 },
      { path: "/signup", weight: 4, cacheable: false, bytes: 12000 },
      { path: "/pricing", weight: 4, cacheable: true, bytes: 30000 },
      { path: "/dashboard", weight: 6, cacheable: false, bytes: 41000 },
      { path: "/lol", weight: 2, cacheable: true, bytes: 1800, errorBias: 4 },
    ],
  },
  {
    host: "api.contoso.com",
    endpoint: "contoso-prod.z01.azurefd.net",
    origin: "contoso-api-eastus",
    routeName: "api-route",
    weight: 38,
    paths: apiPaths,
  },
  {
    host: "cdn.contoso.com",
    endpoint: "contoso-prod.z01.azurefd.net",
    origin: "contoso-blob",
    routeName: "cdn-route",
    weight: 12,
    paths: [
      { path: "/assets/app.js", weight: 24, cacheable: true, bytes: 320000 },
      { path: "/assets/app.css", weight: 18, cacheable: true, bytes: 90000 },
      { path: "/assets/vendor.js", weight: 16, cacheable: true, bytes: 510000 },
      { path: "/images/logo.png", weight: 14, cacheable: true, bytes: 24000 },
      { path: "/fonts/inter.woff2", weight: 12, cacheable: true, bytes: 48000 },
      { path: "/static/charts.js", weight: 10, cacheable: true, bytes: 210000 },
    ],
  },
  {
    host: "nadav.com",
    endpoint: "nadav-personal.z01.azurefd.net",
    origin: "nadav-origin-weu",
    routeName: "nadav-route",
    weight: 16,
    paths: [
      { path: "/", weight: 16, cacheable: true, bytes: 18000 },
      { path: "/api", weight: 20, cacheable: false, bytes: 3400 },
      { path: "/api/users", weight: 14, cacheable: false, bytes: 5200 },
      { path: "/api/login", weight: 10, cacheable: false, bytes: 700, errorBias: 3 },
      { path: "/api/orders", weight: 8, cacheable: false, bytes: 6100, errorBias: 1.4 },
      { path: "/lol", weight: 12, cacheable: true, bytes: 1500 },
      { path: "/blog", weight: 8, cacheable: true, bytes: 26000 },
      { path: "/about", weight: 6, cacheable: true, bytes: 14000 },
      { path: "/contact", weight: 6, cacheable: false, bytes: 9000 },
    ],
  },
];

export const SECURITY_PROTOCOLS = ["TLSv1.2", "TLSv1.3"] as const;
export const HTTP_METHODS_READ = ["GET", "HEAD"] as const;
export const HTTP_METHODS_WRITE = ["POST", "PUT", "PATCH", "DELETE"] as const;
