import { cn } from "@/lib/utils";

type Variant = "default" | "outline" | "ghost" | "subtle" | "danger";
type Size = "sm" | "md" | "icon";

const variants: Record<Variant, string> = {
  default: "bg-accent text-accent-foreground hover:bg-accent/90 border border-transparent",
  outline: "border border-line-strong text-foreground hover:bg-panel-2",
  ghost: "text-muted hover:text-foreground hover:bg-panel-2 border border-transparent",
  subtle: "bg-panel-2 text-foreground hover:bg-line border border-line",
  danger: "bg-danger/15 text-danger hover:bg-danger/25 border border-danger/30",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
  icon: "h-8 w-8 justify-center",
};

export function Button({
  className,
  variant = "default",
  size = "md",
  ...props
}: React.ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={cn(
        "inline-flex items-center rounded-lg font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50 disabled:pointer-events-none cursor-pointer",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
