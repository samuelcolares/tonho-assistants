import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { centsToInput, parseBRLInput } from "./money";

interface BrlInputProps {
  value: number | null;
  onChange: (cents: number | null) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  /** Overrides for the "R$" prefix (position/size). */
  prefixClassName?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Fires on blur/Enter with the parsed value. */
  onCommit?: (cents: number | null) => void;
  "aria-label"?: string;
}

/** Text input for BRL amounts; keeps raw text locally and emits cents (null when empty/invalid). Styled by `CmBrlInput`. */
export function BrlInput({
  value,
  onChange,
  placeholder = "0,00",
  className,
  id,
  prefixClassName,
  disabled,
  autoFocus,
  onCommit,
  ...rest
}: BrlInputProps) {
  const [text, setText] = useState(centsToInput(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(centsToInput(value));
  }, [value, focused]);

  const invalid = text.trim() !== "" && parseBRLInput(text) == null;

  return (
    <div className="relative">
      <span className={cn("pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-cm-muted", prefixClassName)}>
        R$
      </span>
      <input
        id={id}
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={rest["aria-label"]}
        aria-invalid={invalid || undefined}
        className={cn("pl-9 tabular-nums", invalid && "!border-cm-danger", className)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          const cents = parseBRLInput(text);
          setText(centsToInput(cents));
          onCommit?.(cents);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseBRLInput(e.target.value));
        }}
      />
    </div>
  );
}
