import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CmSelect } from "./ui";

/** One block of the settings page: uppercase header + a short plain explanation + its rows. */
export function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`sec-${id}`} className="border-t border-cm-hairline pt-8">
      <h2 id={`sec-${id}`} className="text-[20px] font-bold uppercase leading-tight tracking-[1px] text-cm-ink">
        {title}
      </h2>
      <p className="mt-2 max-w-2xl text-[14px] font-light text-cm-body">{description}</p>
      <div className="mt-4 flex flex-col">{children}</div>
    </section>
  );
}

/** Label + explanation on the left, control on the right (wraps under the text on narrow windows). */
export function SettingRow({
  label,
  hint,
  disabled,
  children,
  className,
}: {
  label: string;
  hint?: string;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-8 gap-y-3 border-t border-cm-hairline py-4 first:border-t-0",
        disabled && "opacity-50",
        className
      )}
    >
      <div className="min-w-[200px] max-w-xl flex-1">
        <p className="text-[14px] font-bold text-cm-ink">{label}</p>
        {hint && <p className="mt-1 text-[13px] font-light text-cm-muted">{hint}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/** The listed options plus the current value when it is not one of them (older or hand-edited settings). */
export function withCurrent(options: number[], current: number): number[] {
  return options.includes(current) ? options : [...options, current].sort((a, b) => a - b);
}

export function NumberSelect({
  value,
  options,
  format,
  onChange,
  disabled,
  label,
}: {
  value: number;
  options: number[];
  format: (n: number) => string;
  onChange: (n: number) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="w-40">
      <CmSelect aria-label={label} value={String(value)} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}>
        {withCurrent(options, value).map((o) => (
          <option key={o} value={o}>
            {format(o)}
          </option>
        ))}
      </CmSelect>
    </div>
  );
}
