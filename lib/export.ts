import type { AccessLogRecord } from "@/lib/domain/types";

const COLUMNS: (keyof AccessLogRecord)[] = [
  "timestamp",
  "trackingRef",
  "method",
  "host",
  "path",
  "query",
  "status",
  "protocol",
  "clientIp",
  "country",
  "city",
  "asn",
  "asnOrg",
  "uaFamily",
  "deviceType",
  "userAgent",
  "ja4",
  "referer",
  "pop",
  "cacheStatus",
  "routeName",
  "requestBytes",
  "responseBytes",
  "timeTaken",
  "timeToFirstByte",
  "errorInfo",
  "originName",
  "originStatus",
];

function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  // Neutralize CSV/formula injection: untrusted log fields (userAgent, referer,
  // path, query…) that begin with =, +, -, @, or a leading control char can be
  // executed as a formula when the export is opened in Excel/Sheets. Prefixing
  // with an apostrophe forces the spreadsheet to treat the cell as text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function recordsToCsv(rows: AccessLogRecord[]): string {
  const header = COLUMNS.join(",");
  const lines = rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(","));
  return [header, ...lines].join("\n");
}

export function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportCsv(rows: AccessLogRecord[], name = "afd-logs") {
  download(`${name}-${Date.now()}.csv`, recordsToCsv(rows), "text/csv;charset=utf-8");
}

export function exportJson(rows: AccessLogRecord[], name = "afd-logs") {
  download(`${name}-${Date.now()}.json`, JSON.stringify(rows, null, 2), "application/json");
}
