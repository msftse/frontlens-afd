import { fmtInt } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Tiny stacked bar showing the 2xx/3xx/4xx/5xx mix for a row. */
export function StatusBar({
  s2,
  s3,
  s4,
  s5,
  className,
}: {
  s2: number;
  s3: number;
  s4: number;
  s5: number;
  className?: string;
}) {
  const total = s2 + s3 + s4 + s5 || 1;
  const segs = [
    { label: "2xx", v: s2, c: "var(--color-success)" },
    { label: "3xx", v: s3, c: "var(--color-info)" },
    { label: "4xx", v: s4, c: "var(--color-warning)" },
    { label: "5xx", v: s5, c: "var(--color-danger)" },
  ];
  return (
    <div
      className={cn("flex h-1.5 w-full overflow-hidden rounded-full bg-line", className)}
      title={segs.map((s) => `${s.label}: ${fmtInt(s.v)}`).join("  ")}
    >
      {segs.map((s) =>
        s.v > 0 ? (
          <span
            key={s.label}
            style={{ width: `${(s.v / total) * 100}%`, background: s.c }}
          />
        ) : null,
      )}
    </div>
  );
}
