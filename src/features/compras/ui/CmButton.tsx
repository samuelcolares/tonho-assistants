import * as React from "react";
import { cn } from "@/lib/utils";

export type CmButtonVariant = "primary-outline" | "strong" | "ghost" | "danger" | "danger-ghost";

const VARIANTS: Record<CmButtonVariant, string> = {
  "primary-outline": "border border-cm-ink bg-transparent text-cm-ink hover:bg-cm-ink hover:text-cm-canvas",
  strong: "border border-cm-ink bg-cm-ink text-cm-canvas hover:bg-cm-body-strong",
  ghost: "border border-transparent bg-transparent text-cm-muted hover:text-cm-ink",
  danger: "border border-cm-danger bg-transparent text-cm-danger hover:bg-cm-danger hover:text-cm-canvas",
  "danger-ghost": "border border-transparent bg-transparent text-cm-danger hover:bg-cm-danger/10",
};

export interface CmButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: CmButtonVariant;
  size?: "md" | "sm";
}

/** Uppercase letterspaced button, radius 0. `strong` = the single main action of a view. */
export const CmButton = React.forwardRef<HTMLButtonElement, CmButtonProps>(
  ({ className, variant = "primary-outline", size = "md", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none text-[12px] font-bold uppercase tracking-[1.5px] transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cm-ink",
        "disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0",
        size === "md" ? "h-11 px-6" : "h-9 px-4",
        VARIANTS[variant],
        className
      )}
      {...props}
    />
  )
);
CmButton.displayName = "CmButton";
