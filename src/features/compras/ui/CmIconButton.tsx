import * as React from "react";
import { cn } from "@/lib/utils";

export interface CmIconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Filled accent (e.g. alert on). */
  active?: boolean;
  size?: "md" | "sm";
  "aria-label": string;
}

/** Round icon button (the only rounded element of the module). */
export const CmIconButton = React.forwardRef<HTMLButtonElement, CmIconButtonProps>(
  ({ className, active = false, size = "md", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cm-ink",
        "disabled:pointer-events-none disabled:opacity-40",
        size === "md" ? "h-10 w-10" : "h-8 w-8",
        active
          ? "border-cm-accent bg-cm-accent text-cm-canvas hover:bg-cm-accent/85"
          : "border-cm-hairline bg-cm-card text-cm-body-strong hover:border-cm-ink hover:text-cm-ink",
        className
      )}
      {...props}
    />
  )
);
CmIconButton.displayName = "CmIconButton";
