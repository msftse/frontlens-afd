import { describe, expect, it } from "vitest";

import type { AccessLogRecord } from "@/lib/domain/types";
import { recordsToCsv } from "@/lib/export";

function rec(p: Partial<AccessLogRecord> = {}): AccessLogRecord {
  return {
    trackingRef: "ref",
    timestamp: "2026-06-01T00:00:00.000Z",
    method: "GET",
    httpVersion: "2.0",
    scheme: "https",
    host: "nadav.com",
    path: "/api",
    query: "",
    url: "https://nadav.com/api",
    status: 200,
    protocol: "HTTPS",
    requestBytes: 100,
    responseBytes: 1000,
    timeTaken: 0.1,
    timeToFirstByte: 0.05,
    clientIp: "203.0.113.5",
    socketIp: "203.0.113.5",
    clientPort: 4000,
    country: "US",
    countryName: "United States",
    city: "Ashburn",
    latitude: 0,
    longitude: 0,
    asn: 7018,
    asnOrg: "AT&T",
    userAgent: "Mozilla/5.0",
    uaFamily: "Chrome",
    uaOs: "Windows",
    deviceType: "desktop",
    ja4: "t13d",
    referer: "",
    endpoint: "ep",
    pop: "LAX",
    cacheStatus: "HIT",
    routeName: "route",
    ruleSetName: "",
    securityProtocol: "TLSv1.3",
    errorInfo: "NoError",
    originName: "origin",
    originStatus: 200,
    ...p,
  };
}

describe("recordsToCsv", () => {
  it("emits a header row with the expected leading columns", () => {
    const header = recordsToCsv([]).split("\n")[0];
    expect(header).toContain("timestamp,trackingRef,method,host,path,query,status");
  });

  it("quotes cells containing commas, quotes or newlines", () => {
    expect(recordsToCsv([rec({ asnOrg: "Acme, Inc" })])).toContain('"Acme, Inc"');
    expect(recordsToCsv([rec({ referer: 'a"b' })])).toContain('"a""b"');
    expect(recordsToCsv([rec({ userAgent: "a\nb" })])).toContain('"a\nb"');
  });

  it("neutralizes spreadsheet formula injection in untrusted fields", () => {
    const csv = recordsToCsv([rec({ userAgent: "=cmd()", referer: "@SUM(1)", path: "-2+3", host: "+x" })]);
    expect(csv).toContain("'=cmd()");
    expect(csv).toContain("'@SUM(1)");
    expect(csv).toContain("'-2+3");
    expect(csv).toContain("'+x");
  });

  it("neutralizes and still quotes when a dangerous value also has a comma", () => {
    expect(recordsToCsv([rec({ userAgent: "+1,2" })])).toContain('"\'+1,2"');
  });

  it("leaves ordinary values untouched", () => {
    const line = recordsToCsv([rec()]).split("\n")[1];
    expect(line).toContain("nadav.com");
    expect(line).toContain("Mozilla/5.0");
    expect(line.startsWith("2026-06-01")).toBe(true);
  });
});
