import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Sharp card: filled (`cm-card`) or outlined on canvas. No shadow. */
export function CmCard({
  className,
  outlined = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { outlined?: boolean }) {
  return (
    <div
      className={cn("rounded-none p-6", outlined ? "border border-cm-hairline bg-cm-canvas" : "bg-cm-card", className)}
      {...props}
    />
  );
}
