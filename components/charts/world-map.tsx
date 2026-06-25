"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";

import type { GeoRow } from "@/lib/domain/types";
import { fmtBytes, fmtInt, fmtPct } from "@/lib/format";

export type GeoMetric = "requests" | "uniqueVisitors" | "bytes";

const g = globalThis as unknown as { __worldMapRegistered?: boolean };

function buildOption(
  data: GeoRow[],
  metric: GeoMetric,
  lookup: Map<string, GeoRow>,
): echarts.EChartsCoreOption {
  const values = data.map((d) => d[metric]);
  const max = Math.max(1, ...values);

  return {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "item",
      backgroundColor: "#ffffff",
      borderColor: "#d2d7dd",
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: "#1d1f24", fontSize: 12 },
      formatter: (p: { name?: string }) => {
        const row = p.name ? lookup.get(p.name) : undefined;
        if (!row) return `<b>${p.name ?? "-"}</b><br/><span style="color:#8a92a0">no traffic</span>`;
        return [
          `<b>${row.countryName}</b> <span style="color:#8a92a0">${row.country}</span>`,
          `Requests: <b>${fmtInt(row.requests)}</b> (${fmtPct(row.share)})`,
          `Visitors: <b>${fmtInt(row.uniqueVisitors)}</b>`,
          `Data: <b>${fmtBytes(row.bytes)}</b>`,
          `Errors: <b>${fmtPct(row.errorRate, 1)}</b>`,
        ].join("<br/>");
      },
    },
    visualMap: {
      min: 0,
      max,
      calculable: true,
      left: 10,
      bottom: 14,
      itemWidth: 10,
      itemHeight: 110,
      textStyle: { color: "#8a92a0", fontSize: 10 },
      inRange: { color: ["#fbe8d3", "#f9c98a", "#f6821f", "#c8650f"] },
      formatter: (v: number) => (metric === "bytes" ? fmtBytes(v) : fmtInt(v)),
    },
    series: [
      {
        type: "map",
        map: "world",
        nameProperty: "name",
        roam: true,
        scaleLimit: { min: 1, max: 8 },
        zoom: 1.18,
        center: [10, 25],
        itemStyle: { areaColor: "#eef1f4", borderColor: "#d2d7dd", borderWidth: 0.5 },
        emphasis: {
          itemStyle: { areaColor: "#fbad41" },
          label: { show: false },
        },
        select: {
          itemStyle: { areaColor: "#f6821f" },
          label: { show: false },
        },
        data: data.map((d) => ({ name: d.country, value: d[metric] })),
      },
    ],
  };
}

export function WorldMap({
  data,
  metric = "requests",
  onSelect,
  height = 460,
}: {
  data: GeoRow[];
  metric?: GeoMetric;
  onSelect?: (iso2: string) => void;
  height?: number;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  // Latest props for the imperative chart, updated in an effect (not during render).
  const selectRef = useRef(onSelect);
  const dataRef = useRef(data);
  const metricRef = useRef(metric);
  useEffect(() => {
    selectRef.current = onSelect;
    dataRef.current = data;
    metricRef.current = metric;
  });

  // Register map (once) + init chart.
  useEffect(() => {
    let cancelled = false;
    let ro: ResizeObserver | null = null;

    const init = () => {
      if (cancelled || !elRef.current) return;
      const chart = echarts.init(elRef.current, undefined, { renderer: "canvas" });
      chartRef.current = chart;
      chart.on("click", (p: { name?: string }) => {
        if (p.name && selectRef.current) selectRef.current(p.name);
      });
      ro = new ResizeObserver(() => chart.resize());
      ro.observe(elRef.current);
      const lookup = new Map(dataRef.current.map((d) => [d.country, d]));
      chart.setOption(buildOption(dataRef.current, metricRef.current, lookup), true);
    };

    if (g.__worldMapRegistered) {
      init();
    } else {
      fetch("/world-countries.json")
        .then((r) => r.json())
        .then((geo) => {
          if (cancelled) return;
          echarts.registerMap("world", geo);
          g.__worldMapRegistered = true;
          init();
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
      ro?.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  // Update data/metric.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const lookup = new Map(data.map((d) => [d.country, d]));
    chart.setOption(buildOption(data, metric, lookup), true);
  }, [data, metric]);

  return (
    <div className="relative w-full" style={{ height }}>
      <div ref={elRef} className="h-full w-full" />
    </div>
  );
}
