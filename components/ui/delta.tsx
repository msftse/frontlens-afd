import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { cn } from "@/lib/utils";
import { fmtDelta } from "@/lib/format";

/**
 * Period-over-period delta pill. `goodWhenUp` flips the color semantics for
 * metrics where a decrease is good (errors, latency).
 */
export function Delta({
  value,
  goodWhenUp = true,
  className,
}: {
  value: number | undefined;
  goodWhenUp?: boolean;
  className?: string;
}) {
  const { text, dir } = fmtDelta(value);
  const isGood = dir === "flat" ? null : (dir === "up") === goodWhenUp;
  const Icon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium tabular",
        isGood === null && "text-faint",
        isGood === true && "text-success",
        isGood === false && "text-danger",
        className,
      )}
      title="vs previous period"
    >
      <Icon className="size-3" />
      {text}
    </span>
  );
}
