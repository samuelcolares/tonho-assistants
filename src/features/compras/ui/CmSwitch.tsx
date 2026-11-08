import { cn } from "@/lib/utils";

/** On/off switch in the Compras look: sharp track, accent when on. */
export function CmSwitch({
  checked,
  onChange,
  disabled,
  "aria-label": ariaLabel,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  "aria-label": string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-none border transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cm-ink",
        "disabled:cursor-not-allowed disabled:opacity-40",
        checked ? "border-cm-accent bg-cm-accent" : "border-cm-hairline bg-cm-card",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-[3px] h-5 w-5 transition-all",
          checked ? "left-[24px] bg-cm-canvas" : "left-[3px] bg-cm-muted"
        )}
      />
    </button>
  );
}
