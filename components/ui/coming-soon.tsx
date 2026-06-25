import { Construction } from "lucide-react";

export function ComingSoon({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="mb-3 flex size-12 items-center justify-center rounded-xl border border-line bg-panel-2 text-accent">
        <Construction className="size-6" />
      </div>
      <h1 className="text-base font-semibold text-foreground">{title}</h1>
      {note && <p className="mt-1 max-w-sm text-sm text-muted">{note}</p>}
    </div>
  );
}
