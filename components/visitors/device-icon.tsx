import { Bot, Monitor, Smartphone, Tablet } from "lucide-react";

import type { DeviceType } from "@/lib/domain/types";

const MAP = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
  bot: Bot,
} as const;

export function DeviceIcon({ type, className }: { type: DeviceType; className?: string }) {
  const Icon = MAP[type] ?? Monitor;
  return <Icon className={className} />;
}
