import * as React from "react";
import { cn } from "@/lib/utils";

export interface CmChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

/** Selectable sharp chip. Selected = accent fill with black text. */
export const CmChip = React.forwardRef<HTMLButtonElement, CmChipProps>(
  ({ className, selected = false, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-none border px-3 text-[12px] font-bold uppercase tracking-[1px] tabular-nums transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cm-ink",
        "disabled:cursor-not-allowed disabled:opacity-35",
        selected
          ? "border-cm-accent bg-cm-accent text-cm-canvas"
          : "border-cm-hairline bg-cm-card text-cm-body-strong enabled:hover:border-cm-ink",
        className
      )}
      {...props}
    />
  )
);
CmChip.displayName = "CmChip";
