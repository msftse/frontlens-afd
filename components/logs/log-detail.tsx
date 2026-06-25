"use client";

import { useState } from "react";
import { Check, Copy, Filter as FilterIcon } from "lucide-react";

import type { AccessLogRecord } from "@/lib/domain/types";
import { fmtBytes, fmtDateTime, fmtMs, flagEmoji } from "@/lib/format";
import { Badge, statusVariant } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function Copyable({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="text-faint transition-colors hover:text-foreground"
      title="Copy"
    >
      {done ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
    </button>
  );
}

function Field({
  label,
  children,
  mono,
  onFilter,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
  onFilter?: () => void;
}) {
  return (
    <div className="group flex items-start justify-between gap-3 px-4 py-1.5">
      <span className="shrink-0 text-[11px] uppercase tracking-wide text-faint">{label}</span>
      <span
        className={cn(
          "flex items-center gap-1.5 text-right text-xs text-foreground",
          mono && "font-mono",
        )}
      >
        {children}
        {onFilter && (
          <button
            onClick={onFilter}
            title="Filter to this value"
            className="opacity-0 transition-opacity group-hover:opacity-100"
          >
            <FilterIcon className="size-3 text-faint hover:text-accent" />
          </button>
        )}
      </span>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-2">
      <div className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-accent/80">
        {title}
      </div>
      <div className="divide-y divide-line/40">{children}</div>
    </div>
  );
}

export interface LogDetailActions {
  filterIp: (ip: string) => void;
  filterHostPath: (host: string, path: string) => void;
  filterStatus: (status: number) => void;
  filterCountry: (iso2: string) => void;
  filterPop: (pop: string) => void;
  filterUa: (ua: string) => void;
}

export function LogDetail({
  record,
  actions,
}: {
  record: AccessLogRecord;
  actions: LogDetailActions;
}) {
  const r = record;
  return (
    <div className="divide-y divide-line">
      <div className="flex items-center gap-2 px-4 py-3">
        <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
        <span className="font-mono text-xs text-muted">{r.method}</span>
        <span className="truncate font-mono text-sm">
          <span className="text-faint">{r.host}</span>
          <span className="text-foreground">{r.path}</span>
        </span>
      </div>

      <Group title="Tracking">
        <Field label="X-Azure-Ref" mono>
          {r.trackingRef}
          <Copyable value={r.trackingRef} />
        </Field>
        <Field label="Time" mono>
          {fmtDateTime(r.timestamp)}
        </Field>
      </Group>

      <Group title="Request">
        <Field label="Method">{r.method}</Field>
        <Field label="URL" mono onFilter={() => actions.filterHostPath(r.host, r.path)}>
          <span className="max-w-[260px] truncate">{r.url}</span>
        </Field>
        <Field label="Protocol" mono>
          {r.protocol} · {r.httpVersion}
        </Field>
        <Field label="TLS" mono>
          {r.securityProtocol}
        </Field>
        <Field label="Referer" mono>
          {r.referer || "(direct)"}
        </Field>
      </Group>

      <Group title="Response & timing">
        <Field label="Status" onFilter={() => actions.filterStatus(r.status)}>
          <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
        </Field>
        <Field label="Error info" mono>
          {r.errorInfo}
        </Field>
        <Field label="Response size" mono>
          {fmtBytes(r.responseBytes)}
        </Field>
        <Field label="Request size" mono>
          {fmtBytes(r.requestBytes)}
        </Field>
        <Field label="Time taken" mono>
          {fmtMs(r.timeTaken * 1000)}
        </Field>
        <Field label="Time to first byte" mono>
          {fmtMs(r.timeToFirstByte * 1000)}
        </Field>
      </Group>

      <Group title="Client & geo">
        <Field label="Client IP" mono onFilter={() => actions.filterIp(r.clientIp)}>
          {r.clientIp}
          <Copyable value={r.clientIp} />
        </Field>
        <Field label="Country" onFilter={() => actions.filterCountry(r.country)}>
          {flagEmoji(r.country)} {r.countryName}
        </Field>
        <Field label="City" mono>
          {r.city}
        </Field>
        <Field label="Network" mono>
          AS{r.asn} {r.asnOrg}
        </Field>
        <Field label="Device / UA" onFilter={() => actions.filterUa(r.uaFamily)}>
          {r.uaFamily} · {r.deviceType}
        </Field>
        <Field label="JA4" mono>
          {r.ja4}
        </Field>
      </Group>

      <Group title="Edge & cache">
        <Field label="PoP" mono onFilter={() => actions.filterPop(r.pop)}>
          {r.pop}
        </Field>
        <Field label="Cache status" mono>
          {r.cacheStatus}
        </Field>
        <Field label="Route" mono>
          {r.routeName}
        </Field>
        <Field label="Endpoint" mono>
          {r.endpoint}
        </Field>
      </Group>

      <Group title="Origin">
        <Field label="Origin" mono>
          {r.originName}
        </Field>
        <Field label="Origin status" mono>
          {r.originStatus || "—"}
        </Field>
      </Group>

      <div className="px-4 py-3">
        <div className="text-[11px] uppercase tracking-wide text-faint">User agent</div>
        <div className="mt-1 break-all font-mono text-[11px] text-muted">{r.userAgent}</div>
      </div>
    </div>
  );
}
