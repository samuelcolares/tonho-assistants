import { cn } from "@/lib/utils";
import type { Verdict } from "@/types";
import { VERDICT_HINT, VERDICT_LABEL } from "../labels";

export type { Verdict };

const STYLE: Record<Verdict, string> = {
  low: "border-cm-accent text-cm-accent",
  normal: "border-cm-hairline text-cm-body",
  high: "border-cm-warn text-cm-warn",
  collecting: "border-dashed border-cm-hairline text-cm-muted",
};

/** Sharp uppercase verdict chip. Renders nothing without a verdict (no current price). */
export function VerdictChip({ verdict, className }: { verdict: Verdict | null | undefined; className?: string }) {
  if (!verdict) return null;
  return (
    <span
      title={VERDICT_HINT[verdict]}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-none border px-2 py-0.5 text-[11px] font-bold uppercase tracking-[1.5px]",
        STYLE[verdict],
        className
      )}
    >
      {VERDICT_LABEL[verdict]}
    </span>
  );
}
