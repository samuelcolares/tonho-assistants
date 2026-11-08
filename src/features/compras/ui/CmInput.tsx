import * as React from "react";
import { cn } from "@/lib/utils";
import { BrlInput } from "../BrlInput";

const BASE =
  "w-full rounded-none border border-cm-hairline bg-cm-card px-4 font-light text-cm-ink placeholder:text-cm-muted focus-visible:border-cm-ink focus-visible:outline-none focus-visible:ring-0 disabled:opacity-50";

/** Text input: 48px, sharp, focus = white border. */
export const CmInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn("h-12 text-[14px]", BASE, className)} {...props} />
);
CmInput.displayName = "CmInput";

interface CmBrlInputProps {
  value: number | null;
  onChange: (cents: number | null) => void;
  /** `lg` = 64px / 30px bold (hero price field). */
  size?: "md" | "lg";
  id?: string;
  autoFocus?: boolean;
  placeholder?: string;
  disabled?: boolean;
  "aria-label"?: string;
  onCommit?: (cents: number | null) => void;
}

/** BRL field (same parsing as BrlInput) in the Compras look. */
export function CmBrlInput({ size = "md", ...props }: CmBrlInputProps) {
  const lg = size === "lg";
  return (
    <BrlInput
      {...props}
      prefixClassName={cn("left-4 font-bold text-cm-muted", lg ? "text-[18px]" : "text-[13px]")}
      className={cn(BASE, "font-bold", lg ? "h-16 pl-14 text-[30px]" : "h-12 pl-11 text-[14px]")}
    />
  );
}
