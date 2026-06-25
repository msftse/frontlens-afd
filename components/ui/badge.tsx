import { cn } from "@/lib/utils";

type Variant = "default" | "success" | "warning" | "danger" | "info" | "outline" | "accent";

const variants: Record<Variant, string> = {
  default: "bg-panel-2 text-muted border-line",
  outline: "bg-transparent text-muted border-line-strong",
  accent: "bg-accent/15 text-accent border-accent/30",
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  danger: "bg-danger/15 text-danger border-danger/30",
  info: "bg-info/15 text-info border-info/30",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"span"> & { variant?: Variant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none tabular",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

/** Color a status badge by HTTP status class. */
export function statusVariant(status: number): Variant {
  if (status >= 500 || status === 0) return "danger";
  if (status >= 400) return "warning";
  if (status >= 300) return "info";
  if (status >= 200) return "success";
  return "default";
}
