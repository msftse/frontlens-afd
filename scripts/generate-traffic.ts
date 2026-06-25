/**
 * Generate REAL Azure Front Door traffic so the Log Analytics workspace fills
 * with genuine `FrontDoorAccessLog` rows — the data the dashboard's "Live" mode
 * queries. This drives requests against YOUR OWN test AFD endpoint to exercise
 * the edge (and, optionally, the WAF) and produce real, non-mock telemetry.
 *
 * Resolve the endpoint host from the e2e stack, then run:
 *
 *   HOST=$(az deployment group show -g frontlens-e2e-rg -n afd-e2e \
 *           --query properties.outputs.afdEndpointHostName.value -o tsv)
 *   npm run gen:traffic -- --host "$HOST" --count 1500
 *
 * Common flags (all optional except --host / AFD_TARGET_HOST):
 *   --host <fqdn|url>   Target AFD endpoint (or env AFD_TARGET_HOST). REQUIRED.
 *   --count <n>         Total requests to send         (env TRAFFIC_COUNT, default 1000).
 *   --duration <sec>    Run for N seconds instead of a fixed count (continuous mode).
 *   --concurrency <n>   Parallel in-flight requests     (env TRAFFIC_CONCURRENCY, default 20).
 *   --rate <rps>        Cap requests/second (0 = unbounded, env TRAFFIC_RPS, default 0).
 *   --no-waf           Skip the handful of WAF smoke-test probes (on by default).
 *   --timeout <ms>      Per-request timeout            (default 10000).
 *
 * Logs land in Log Analytics a few minutes after the requests (ingestion lag),
 * so wait ~5–15 min before checking "Live" mode. Keep volume modest — the e2e
 * workspace has a 1 GB/day cap.
 *
 * curl alternative (no Node): for HOST set above,
 *   for i in $(seq 1 500); do curl -s -o /dev/null "https://$HOST/api/quote?i=$i"; done
 */

// ---- request catalogue --------------------------------------------------------

/** Realistic site paths (weighted) — most return 200/404 from the test origin. */
const PATHS: { path: string; weight: number; method?: string }[] = [
  { path: "/", weight: 30 },
  { path: "/about", weight: 4 },
  { path: "/contact", weight: 3 },
  { path: "/pricing", weight: 4 },
  { path: "/products", weight: 8 },
  { path: "/products/123", weight: 5 },
  { path: "/products/456", weight: 4 },
  { path: "/blog", weight: 5 },
  { path: "/blog/hello-world", weight: 3 },
  { path: "/search?q=stocks", weight: 5 },
  { path: "/api/quote", weight: 12 },
  { path: "/api/news", weight: 10 },
  { path: "/api/v1/quote", weight: 6 },
  { path: "/api/v1/news", weight: 5 },
  { path: "/api/portfolio", weight: 4, method: "POST" },
  { path: "/login", weight: 4, method: "POST" },
  { path: "/signup", weight: 2, method: "POST" },
  { path: "/assets/app.js", weight: 8 },
  { path: "/assets/style.css", weight: 8 },
  { path: "/favicon.ico", weight: 6 },
  { path: "/robots.txt", weight: 2 },
];

/** Paths that should 404 / 4xx at the origin — adds status-class variety. */
const NOT_FOUND: { path: string; weight: number }[] = [
  { path: "/old-landing-page", weight: 3 },
  { path: "/api/legacy/quote", weight: 3 },
  { path: "/downloads/report.pdf", weight: 2 },
  { path: "/wp-admin", weight: 2 },
  { path: "/.git/config", weight: 1 },
];

/**
 * WAF smoke-test probes. These intentionally look malicious so AFD's WAF
 * (Prevention mode) blocks them with 403 and writes a WAFLog row. They target
 * ONLY the user's own test endpoint to validate the WAF and generate security
 * telemetry — not a real system. Kept tiny and disabled via --no-waf.
 */
const WAF_PROBES: { path: string; weight: number }[] = [
  { path: "/?q=%3Cscript%3Ealert(1)%3C/script%3E", weight: 1 },
  { path: "/search?q=1%27%20OR%20%271%27%3D%271", weight: 1 },
  { path: "/api/quote?id=1%3BDROP%20TABLE%20users", weight: 1 },
  { path: "/index.php?page=../../../../etc/passwd", weight: 1 },
];

/** A spread of User-Agents so uaFamily / deviceType vary in the logs. */
const USER_AGENTS: string[] = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  "curl/8.4.0",
];

// ---- config -------------------------------------------------------------------

interface Config {
  base: string;
  count: number;
  durationMs: number;
  concurrency: number;
  rps: number;
  timeoutMs: number;
  waf: boolean;
}

function parseArgs(argv: string[]): Config {
  const flags = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    if (key.includes("=")) {
      const eq = key.indexOf("=");
      flags.set(key.slice(0, eq), key.slice(eq + 1));
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      flags.set(key, argv[++i]);
    } else {
      bools.add(key);
    }
  }

  const rawHost = flags.get("host") ?? process.env.AFD_TARGET_HOST ?? "";
  if (!rawHost) {
    console.error(
      "✗ Missing target. Pass --host <afd-endpoint-fqdn> or set AFD_TARGET_HOST.\n" +
        "  Resolve it with:\n" +
        "    az deployment group show -g frontlens-e2e-rg -n afd-e2e \\\n" +
        "      --query properties.outputs.afdEndpointHostName.value -o tsv",
    );
    process.exit(2);
  }
  const base = (rawHost.includes("://") ? rawHost : `https://${rawHost}`).replace(/\/+$/, "");

  const num = (k: string, env: string | undefined, def: number) => {
    const v = flags.get(k) ?? env;
    const n = v == null ? def : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : def;
  };

  return {
    base,
    count: Math.floor(num("count", process.env.TRAFFIC_COUNT, 1000)),
    durationMs: Math.floor(num("duration", undefined, 0) * 1000),
    concurrency: Math.max(1, Math.floor(num("concurrency", process.env.TRAFFIC_CONCURRENCY, 20))),
    rps: num("rate", process.env.TRAFFIC_RPS, 0),
    timeoutMs: Math.max(1000, Math.floor(num("timeout", undefined, 10000))),
    waf: !bools.has("no-waf") && process.env.TRAFFIC_WAF !== "0",
  };
}

// ---- weighted picking ---------------------------------------------------------

type Entry = { path: string; method?: string };

function buildPool(cfg: Config): { entry: Entry; cum: number }[] {
  const pool: { entry: Entry; cum: number }[] = [];
  let total = 0;
  const add = (items: { path: string; weight: number; method?: string }[]) => {
    for (const it of items) {
      total += it.weight;
      pool.push({ entry: { path: it.path, method: it.method }, cum: total });
    }
  };
  add(PATHS);
  add(NOT_FOUND);
  if (cfg.waf) add(WAF_PROBES);
  return pool;
}

function pick<T>(pool: { entry: T; cum: number }[]): T {
  const r = Math.random() * pool[pool.length - 1].cum;
  for (const p of pool) if (r <= p.cum) return p.entry;
  return pool[pool.length - 1].entry;
}

const randomUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

// ---- runner -------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  const pool = buildPool(cfg);
  const continuous = cfg.durationMs > 0;
  const endAt = continuous ? Date.now() + cfg.durationMs : 0;

  console.log(`→ target   ${cfg.base}`);
  console.log(
    `→ plan     ${continuous ? `${cfg.durationMs / 1000}s continuous` : `${cfg.count} requests`}` +
      `, concurrency ${cfg.concurrency}` +
      (cfg.rps ? `, ≤${cfg.rps} rps` : "") +
      `, WAF probes ${cfg.waf ? "on" : "off"}`,
  );

  const status = new Map<number, number>();
  let sent = 0;
  let errors = 0;
  const started = Date.now();

  // Optional rate limiter: hand out evenly-spaced start slots.
  let nextSlot = started;
  const slotMs = cfg.rps > 0 ? 1000 / cfg.rps : 0;
  async function gate() {
    if (slotMs <= 0) return;
    const slot = nextSlot;
    nextSlot += slotMs;
    const wait = slot - Date.now();
    if (wait > 0) await sleep(wait);
  }

  const more = () => (continuous ? Date.now() < endAt : sent < cfg.count);

  async function oneRequest() {
    const entry = pick(pool);
    const method = entry.method ?? (Math.random() < 0.05 ? "HEAD" : "GET");
    const url = `${cfg.base}${entry.path}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "user-agent": randomUA(), accept: "*/*" },
      });
      status.set(res.status, (status.get(res.status) ?? 0) + 1);
      // Drain the (small) body so sockets are released promptly.
      await res.arrayBuffer().catch(() => {});
    } catch {
      errors++;
    } finally {
      clearTimeout(timer);
    }
  }

  async function worker() {
    while (more()) {
      await gate();
      if (!more()) break;
      sent++;
      await oneRequest();
      if (sent % 100 === 0) {
        const secs = (Date.now() - started) / 1000;
        process.stdout.write(`  sent ${sent} (${(sent / secs).toFixed(0)} rps)\r`);
      }
    }
  }

  await Promise.all(Array.from({ length: cfg.concurrency }, worker));

  const secs = (Date.now() - started) / 1000;
  console.log(`\n✓ done — ${sent} requests in ${secs.toFixed(1)}s (${(sent / secs).toFixed(0)} rps)`);
  const codes = [...status.entries()].sort((a, b) => a[0] - b[0]);
  for (const [code, n] of codes) console.log(`    ${code}  ${n}`);
  if (errors) console.log(`    err  ${errors} (timeout/network)`);
  console.log("→ allow ~5–15 min for Log Analytics ingestion, then check Live mode.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
