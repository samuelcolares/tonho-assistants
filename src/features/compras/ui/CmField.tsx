import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CmLabel } from "./CmLabel";

/** Uppercase label + control + optional muted hint. */
export function CmField({
  label,
  hint,
  htmlFor,
  className,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <CmLabel htmlFor={htmlFor}>{label}</CmLabel>
      {children}
      {hint && <p className="text-[12px] font-light text-cm-muted">{hint}</p>}
    </div>
  );
}
