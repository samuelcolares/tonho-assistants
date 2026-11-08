import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Native select in the Compras look: 48px, sharp, hairline, focus = white border. */
export const CmSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          "h-12 w-full appearance-none rounded-none border border-cm-hairline bg-cm-card pl-4 pr-10 text-[14px] font-light text-cm-ink",
          "focus-visible:border-cm-ink focus-visible:outline-none disabled:opacity-50",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cm-muted" />
    </div>
  )
);
CmSelect.displayName = "CmSelect";

/** Native checkbox with a text label. */
export function CmCheckbox({
  checked,
  onChange,
  children,
  className,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-3 text-[14px] font-light text-cm-body-strong", className)}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 cursor-pointer rounded-none accent-[#2dc98a]"
      />
      {children}
    </label>
  );
}
