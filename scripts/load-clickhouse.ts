/**
 * Seed a local ClickHouse with synthetic AFD access logs.
 *
 *   docker compose up -d clickhouse
 *   npm run ch:load                 # applies schema + inserts ~200k rows
 *   AFD_DATASOURCE=clickhouse CLICKHOUSE_PASSWORD=frontlens npm run dev
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@clickhouse/client";

import { generateDataset } from "@/lib/datasource/mock/generate";

function splitStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

function chTimestamp(iso: string): string {
  // DateTime64(3) basic format, UTC: "YYYY-MM-DD HH:MM:SS.fff"
  return iso.replace("T", " ").replace("Z", "");
}

async function main() {
  const client = createClient({
    url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
    username: process.env.CLICKHOUSE_USER ?? "default",
    password: process.env.CLICKHOUSE_PASSWORD ?? "frontlens",
    database: process.env.CLICKHOUSE_DATABASE ?? "afd",
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });

  console.log("→ applying schema…");
  for (const file of ["ingest/01_schema.sql", "ingest/02_rollups.sql"]) {
    const sql = readFileSync(resolve(process.cwd(), file), "utf8");
    for (const stmt of splitStatements(sql)) {
      await client.command({ query: stmt });
    }
    console.log(`  ✓ ${file}`);
  }

  const records = Number(process.env.MOCK_RECORDS ?? 200_000);
  const visitors = Number(process.env.MOCK_VISITORS ?? 2_000);
  console.log(`→ generating ${records.toLocaleString()} records (${visitors} visitors)…`);
  const ds = generateDataset({ records, visitors });

  console.log("→ truncating + inserting…");
  await client.command({ query: "TRUNCATE TABLE IF EXISTS afd.access_logs" });
  // Rollups are fed by materialized views that fire on each INSERT, so clear
  // them too — otherwise re-running the loader double-counts aggregated rows.
  await client.command({ query: "TRUNCATE TABLE IF EXISTS afd.rollup_traffic_1m" });
  await client.command({ query: "TRUNCATE TABLE IF EXISTS afd.rollup_paths_1h" });

  const batchSize = 50_000;
  for (let i = 0; i < ds.records.length; i += batchSize) {
    const batch = ds.records
      .slice(i, i + batchSize)
      .map((r) => ({ ...r, timestamp: chTimestamp(r.timestamp) }));
    await client.insert({ table: "afd.access_logs", values: batch, format: "JSONEachRow" });
    process.stdout.write(`  ${Math.min(i + batchSize, ds.records.length).toLocaleString()}\r`);
  }

  const [{ c }] = await (
    await client.query({ query: "SELECT count() AS c FROM afd.access_logs", format: "JSONEachRow" })
  ).json<{ c: string }>();
  console.log(`\n✓ done — ${Number(c).toLocaleString()} rows in afd.access_logs`);
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
