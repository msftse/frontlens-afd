import { describe, expect, it } from "vitest";

import {
  UNSUPPORTED_REASON,
  isDimensionSupported,
  isWafSupported,
  partitionDimensions,
  toSourceKind,
} from "@/lib/datasource/capabilities";
import type { Dimension } from "@/lib/domain/types";

describe("toSourceKind", () => {
  it("passes through the three known kinds", () => {
    expect(toSourceKind("loganalytics")).toBe("loganalytics");
    expect(toSourceKind("clickhouse")).toBe("clickhouse");
    expect(toSourceKind("mock")).toBe("mock");
  });

  it("falls open to mock for null/unknown sources", () => {
    expect(toSourceKind(null)).toBe("mock");
    expect(toSourceKind(undefined)).toBe("mock");
    expect(toSourceKind("something-else")).toBe("mock");
  });
});

describe("isDimensionSupported", () => {
  it("hides ASN and city on Log Analytics (real AFD gaps)", () => {
    expect(isDimensionSupported("loganalytics", "asnOrg")).toBe(false);
    expect(isDimensionSupported("loganalytics", "city")).toBe(false);
  });

  it("keeps the real AFD dimensions on Log Analytics, including derived uaFamily", () => {
    for (const d of ["path", "country", "clientIp", "pop", "ja4", "status", "errorInfo", "uaFamily"] as Dimension[]) {
      expect(isDimensionSupported("loganalytics", d)).toBe(true);
    }
  });

  it("supports every dimension on mock and clickhouse (ingestion-enriched)", () => {
    for (const d of ["asnOrg", "uaFamily", "city"] as Dimension[]) {
      expect(isDimensionSupported("mock", d)).toBe(true);
      expect(isDimensionSupported("clickhouse", d)).toBe(true);
    }
  });
});

describe("isWafSupported", () => {
  it("is true for Front Door and mock, false for ClickHouse", () => {
    expect(isWafSupported("loganalytics")).toBe(true);
    expect(isWafSupported("mock")).toBe(true);
    expect(isWafSupported("clickhouse")).toBe(false);
  });
});

describe("partitionDimensions", () => {
  const dims = [
    { dimension: "path" as Dimension, label: "Top paths" },
    { dimension: "asnOrg" as Dimension, label: "Networks" },
    { dimension: "country" as Dimension, label: "Countries" },
    { dimension: "city" as Dimension, label: "Cities" },
  ];

  it("splits supported vs hidden on Log Analytics preserving order", () => {
    const { supported, hidden } = partitionDimensions("loganalytics", dims);
    expect(supported.map((d) => d.dimension)).toEqual(["path", "country"]);
    expect(hidden.map((d) => d.dimension)).toEqual(["asnOrg", "city"]);
  });

  it("hides nothing on mock", () => {
    const { supported, hidden } = partitionDimensions("mock", dims);
    expect(supported).toHaveLength(4);
    expect(hidden).toHaveLength(0);
  });

  it("has a human reason for every hideable dimension", () => {
    const { hidden } = partitionDimensions("loganalytics", dims);
    for (const d of hidden) {
      expect(UNSUPPORTED_REASON[d.dimension]).toBeTruthy();
    }
  });
});
