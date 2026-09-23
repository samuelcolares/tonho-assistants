import { Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type ReminderRepeat = "none" | "daily" | "weekly" | "monthly" | "yearly";

const REPEAT_LABELS: Record<Exclude<ReminderRepeat, "none">, string> = {
  daily: "diário",
  weekly: "semanal",
  monthly: "mensal",
  yearly: "anual",
};

export interface ReminderItemProps {
  title: string;
  datetime: string;
  repeat: ReminderRepeat;
  overdue?: boolean;
  done?: boolean;
  notes?: string;
  onToggleDone?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function ReminderItem({
  title,
  datetime,
  repeat,
  overdue = false,
  done = false,
  notes,
  onToggleDone,
  onEdit,
  onDelete,
}: ReminderItemProps) {
  const dotClass = done ? "bg-ink-faint" : overdue ? "bg-warning" : "bg-dante";

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-bg-100 p-3.5">
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={done}
          onChange={onToggleDone}
          className="h-4 w-4 shrink-0 accent-brand-solid"
        />
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass)} />
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-sm font-semibold", done ? "text-ink-faint line-through" : "text-ink")}>
            {title}
          </p>
          <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-muted">
            <span>{datetime}</span>
            {repeat !== "none" && <Badge variant="dante">{REPEAT_LABELS[repeat]}</Badge>}
            {overdue && !done && <Badge variant="warning">Atrasado</Badge>}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onEdit} title="Editar">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          title="Excluir"
          className="hover:bg-danger-subtle hover:text-danger"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {notes && <p className="pl-[26px] text-[12.5px] text-ink-muted">{notes}</p>}
    </div>
  );
}
