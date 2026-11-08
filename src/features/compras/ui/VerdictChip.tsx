import { cn } from "@/lib/utils";

export type Verdict = "low" | "normal" | "high" | "collecting";

const STYLE: Record<Verdict, { label: string; cls: string }> = {
  low: { label: "Preço baixo", cls: "border-cm-accent text-cm-accent" },
  normal: { label: "Preço normal", cls: "border-cm-hairline text-cm-body" },
  high: { label: "Preço alto", cls: "border-cm-warn text-cm-warn" },
  collecting: { label: "Ainda aprendendo", cls: "border-dashed border-cm-hairline text-cm-muted" },
};

/** Stub for P3: the backend verdict is not available yet, so callers may pass null (renders nothing). */
export function VerdictChip({ verdict, className }: { verdict: Verdict | null | undefined; className?: string }) {
  if (!verdict) return null;
  const s = STYLE[verdict];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-none border px-2 py-0.5 text-[11px] font-bold uppercase tracking-[1.5px]",
        s.cls,
        className
      )}
    >
      {s.label}
    </span>
  );
}
