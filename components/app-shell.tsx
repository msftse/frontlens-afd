"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Globe2,
  LayoutDashboard,
  Radar,
  Route,
  ScrollText,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useReportedDataSource } from "@/lib/api/source";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/anomalies", label: "Anomalies", icon: Activity },
  { href: "/paths", label: "Path Explorer", icon: Route },
  { href: "/visitors", label: "Visitors", icon: Users },
  { href: "/geography", label: "Geography", icon: Globe2 },
  { href: "/logs", label: "Log Explorer", icon: ScrollText },
];

/** Friendly label + liveness for the active data source badge. */
const SOURCE_META: Record<string, { label: string; live: boolean }> = {
  mock: { label: "Mock data source", live: false },
  clickhouse: { label: "ClickHouse · live", live: true },
  loganalytics: { label: "Log Analytics · live", live: true },
};

export function Sidebar({
  footer,
  dataSource = "mock",
}: {
  footer?: React.ReactNode;
  dataSource?: string;
}) {
  const pathname = usePathname();
  // Prefer the source the server actually reported; fall back to the SSR hint.
  const reported = useReportedDataSource();
  const active = reported ?? dataSource;
  const meta = SOURCE_META[active] ?? { label: active, live: true };
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-2 text-accent-foreground shadow-sm">
          <Radar className="size-4.5" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight">FrontLens</div>
          <div className="text-[11px] text-faint">Front Door analytics</div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-2 py-3">
        {NAV.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-accent/10 text-foreground"
                  : "text-muted hover:bg-panel-2 hover:text-foreground",
              )}
            >
              <Icon
                className={cn("size-4.5", active ? "text-accent" : "text-faint group-hover:text-muted")}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-2 border-t border-line p-3">
        {footer}
        <div className="flex items-center gap-2 rounded-lg bg-panel-2/50 px-2.5 py-2 text-[11px] text-faint">
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              meta.live ? "bg-success" : "bg-warning",
            )}
          />
          <span className="truncate">{meta.label}</span>
        </div>
      </div>
    </aside>
  );
}
