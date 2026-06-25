import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  availableSourceKinds,
  defaultSourceKind,
  resolveSourceKind,
} from "@/lib/datasource/index";

/**
 * Unit tests for the source-resolution logic — the security boundary between a
 * client's requested `source` and the data source that actually runs. Verifies
 * the allowlist, the configured-ness gating, and the safe fallback. Pure env
 * logic only (no data source is constructed here).
 */

const ENV_KEYS = ["AFD_DATASOURCE", "AFD_SOURCES", "LOG_ANALYTICS_WORKSPACE_ID", "CLICKHOUSE_URL"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("defaultSourceKind", () => {
  it("defaults to mock when unset", () => {
    expect(defaultSourceKind()).toBe("mock");
  });
  it("honours a known AFD_DATASOURCE", () => {
    process.env.AFD_DATASOURCE = "loganalytics";
    expect(defaultSourceKind()).toBe("loganalytics");
  });
  it("ignores an unknown AFD_DATASOURCE", () => {
    process.env.AFD_DATASOURCE = "bogus";
    expect(defaultSourceKind()).toBe("mock");
  });
});

describe("availableSourceKinds", () => {
  it("is just [mock] with no config", () => {
    expect(availableSourceKinds()).toEqual(["mock"]);
  });

  it("drops loganalytics when its workspace id is missing (unconfigured)", () => {
    process.env.AFD_SOURCES = "mock,loganalytics";
    expect(availableSourceKinds()).toEqual(["mock"]);
  });

  it("includes loganalytics once configured", () => {
    process.env.AFD_SOURCES = "mock,loganalytics";
    process.env.LOG_ANALYTICS_WORKSPACE_ID = "ws-guid";
    expect(availableSourceKinds()).toEqual(["mock", "loganalytics"]);
  });

  it("filters unknown entries and keeps a stable order", () => {
    process.env.AFD_SOURCES = "loganalytics,unknown,clickhouse,mock";
    process.env.LOG_ANALYTICS_WORKSPACE_ID = "ws-guid";
    process.env.CLICKHOUSE_URL = "http://ch:8123";
    expect(availableSourceKinds()).toEqual(["mock", "loganalytics", "clickhouse"]);
  });

  it("always includes the configured default", () => {
    process.env.AFD_DATASOURCE = "clickhouse";
    process.env.CLICKHOUSE_URL = "http://ch:8123";
    expect(availableSourceKinds()).toContain("clickhouse");
  });
});

describe("resolveSourceKind", () => {
  it("returns the default when nothing is requested", () => {
    expect(resolveSourceKind()).toBe("mock");
    expect(resolveSourceKind(null)).toBe("mock");
    expect(resolveSourceKind("")).toBe("mock");
  });

  it("honours an allowed, configured request", () => {
    process.env.AFD_SOURCES = "mock,loganalytics";
    process.env.LOG_ANALYTICS_WORKSPACE_ID = "ws-guid";
    expect(resolveSourceKind("loganalytics")).toBe("loganalytics");
  });

  it("falls back to mock when the requested source is unconfigured", () => {
    process.env.AFD_SOURCES = "mock,loganalytics"; // but no workspace id
    expect(resolveSourceKind("loganalytics")).toBe("mock");
  });

  it("falls back for an unknown / not-allowlisted source (no injection)", () => {
    expect(resolveSourceKind("bogus")).toBe("mock");
    expect(resolveSourceKind("clickhouse")).toBe("mock"); // not in AFD_SOURCES
  });

  it("falls back to mock when the default itself is unconfigured", () => {
    process.env.AFD_DATASOURCE = "loganalytics"; // default, but no workspace id
    expect(resolveSourceKind()).toBe("mock");
    expect(resolveSourceKind("loganalytics")).toBe("mock");
  });
});
