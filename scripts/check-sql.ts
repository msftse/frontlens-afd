/**
 * No-DB validation of the ClickHouse SQL compiler: asserts the WHERE clause and
 * parameters are well-formed and mirror the mock matcher's semantics. Run with:
 *   npx tsx scripts/check-sql.ts
 */
import { filterSchema, resolveTimeRange } from "@/lib/filters/model";
import {
  applyFilter,
  cidrRange,
  dimExpr,
  pathGroupExpr,
  SqlBuilder,
} from "@/lib/datasource/clickhouse/sql";

let failures = 0;
function assert(label: string, cond: boolean) {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures++;
}

const f = filterSchema.parse({
  range: "7d",
  host: ["nadav.com"],
  country: ["US", "IL"],
  path: [
    { mode: "regex", value: "a{1,3}" }, // comma inside a single value
    { mode: "prefix", value: "nadav.com/api" },
    { mode: "glob", value: "/api/*" },
  ],
  status: ["4xx", 500],
  cidr: ["203.0.113.0/24"],
  q: "foo,bar",
});

const { from, to } = resolveTimeRange(f);
const s = new SqlBuilder();
applyFilter(s, f, from, to);
const where = s.where();
const params = Object.values(s.params);

console.log("\nWHERE:\n" + where + "\n");
console.log("PARAMS:", params, "\n");

assert("regex value with comma kept as one param", params.includes("(?i)a{1,3}"));
assert("free-text q with comma kept as one param", params.includes("foo,bar"));
assert("country IN passed as array param", params.some((p) => Array.isArray(p) && p.join() === "US,IL"));
assert("prefix matches BOTH path and host+path", /startsWith\(lowerUTF8\(path\).*OR startsWith\(lowerUTF8\(hostPath\)/.test(where));
assert("glob/regex use match() on path and hostPath", /match\(path,.*OR match\(hostPath/.test(where));
assert("status filter emits class and exact predicates", where.includes("statusClass = ") && where.includes("status = "));

const r = cidrRange("203.0.113.0/24");
assert("cidr range computed", r?.start === 0xcb007100 && r?.end === 0xcb0071ff);
assert("cidr start+end present as params", !!r && params.includes(r.start) && params.includes(r.end));
assert("time bounds use fromUnixTimestamp64Milli", where.includes("fromUnixTimestamp64Milli"));

assert("dimExpr(path) groups by hostPath", dimExpr("path").key === "hostPath");
assert("pathGroupExpr(0) is raw path", pathGroupExpr(0) === "path");
assert("pathGroupExpr(2) trims to 2 segments", pathGroupExpr(2).includes("arraySlice"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
