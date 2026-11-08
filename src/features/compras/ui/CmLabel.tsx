import type { LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Uppercase 12px/700/1.5px label. */
export function CmLabel({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[12px] font-bold uppercase tracking-[1.5px] text-cm-muted", className)} {...props} />;
}
