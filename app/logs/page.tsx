"use client";

import { useMemo, useState } from "react";
import { ArrowDownUp, Download, FileJson, ScrollText } from "lucide-react";

import { useFilters } from "@/lib/filters/use-filters";
import { useInfiniteLogs } from "@/lib/api/hooks";
import { api } from "@/lib/api/client";
import type { AccessLogRecord } from "@/lib/domain/types";
import { exportCsv, exportJson } from "@/lib/export";
import { fmtInt } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { LogTable } from "@/components/logs/log-table";
import { LogDetail, type LogDetailActions } from "@/components/logs/log-detail";

export default function LogExplorerPage() {
  const fh = useFilters();
  const { filter } = fh;
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<AccessLogRecord | null>(null);
  const [exporting, setExporting] = useState(false);

  const q = useInfiniteLogs(filter, sortDir, 100);
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.rows) ?? [], [q.data]);
  const total = q.data?.pages[0]?.total ?? 0;

  const actions: LogDetailActions = {
    filterIp: (ip) => {
      fh.toggle("clientIp", ip);
      setSelected(null);
    },
    filterHostPath: (host, path) => {
      fh.addPath({ mode: "exact", value: `${host}${path}` });
      setSelected(null);
    },
    filterStatus: (s) => {
      fh.toggleStatus(s);
      setSelected(null);
    },
    filterCountry: (iso2) => {
      fh.toggle("country", iso2);
      setSelected(null);
    },
    filterPop: (pop) => {
      fh.toggle("pop", pop);
      setSelected(null);
    },
    filterUa: (ua) => {
      fh.toggle("uaFamily", ua);
      setSelected(null);
    },
  };

  const doExport = async (kind: "csv" | "json") => {
    setExporting(true);
    try {
      const page = await api.logs(filter, { limit: 5000, sortDir });
      if (kind === "csv") exportCsv(page.rows);
      else exportJson(page.rows);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-3">
      <PageHeader
        title="Log Explorer"
        description="Every raw access-log line. Filter, inspect any request, and export."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
              title="Toggle sort order"
            >
              <ArrowDownUp className="size-3.5" />
              {sortDir === "desc" ? "Newest" : "Oldest"}
            </Button>
            <Button variant="subtle" size="sm" disabled={exporting} onClick={() => doExport("csv")}>
              <Download className="size-3.5" />
              CSV
            </Button>
            <Button variant="subtle" size="sm" disabled={exporting} onClick={() => doExport("json")}>
              <FileJson className="size-3.5" />
              JSON
            </Button>
          </div>
        }
      />

      <div className="flex items-center gap-1.5 px-1 text-xs text-faint">
        <ScrollText className="size-3.5" />
        <span className="font-semibold tabular text-foreground">{fmtInt(total)}</span> matching
        requests
        <span className="text-line-strong">·</span>
        loaded {fmtInt(rows.length)}
      </div>

      <LogTable
        rows={rows}
        loading={q.isLoading}
        selectedRef={selected?.trackingRef ?? null}
        onRowClick={setSelected}
        hasNextPage={!!q.hasNextPage}
        fetchNextPage={q.fetchNextPage}
        isFetchingNextPage={q.isFetchingNextPage}
      />

      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        width={480}
        title={selected ? <span className="font-mono text-xs">{selected.trackingRef}</span> : ""}
      >
        {selected && <LogDetail record={selected} actions={actions} />}
      </Drawer>
    </div>
  );
}
