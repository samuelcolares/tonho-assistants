import { CmChip } from "./ui";
import { PRIORITY_OPTIONS, priorityOf } from "./rooms";

interface PriorityChipsProps {
  value: number;
  onChange: (priority: number) => void;
  className?: string;
  /** Tighter chips for narrow columns (dialogs). */
  compact?: boolean;
}

/** AGORA / EM BREVE / UM DIA. */
export function PriorityChips({ value, onChange, className, compact = false }: PriorityChipsProps) {
  const current = priorityOf(value);
  return (
    <div className={className ?? "flex gap-2"} role="group" aria-label="Prioridade">
      {PRIORITY_OPTIONS.map((o) => (
        <CmChip key={o.value} className={compact ? "h-12 flex-1 whitespace-nowrap px-1 text-[11px] tracking-[0.5px]" : "h-12 flex-1 px-2"} selected={current === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </CmChip>
      ))}
    </div>
  );
}
