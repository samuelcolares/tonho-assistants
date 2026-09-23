import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";

export interface RuleCardProps {
  title: string;
  description: string;
  active: boolean;
  onToggle?: (active: boolean) => void;
  actions?: React.ReactNode;
}

export function RuleCard({ title, description, active, onToggle, actions }: RuleCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-100 p-4">
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-semibold", active ? "text-ink" : "text-ink-muted")}>
          {title}
        </p>
        <p className={cn("mt-0.5 text-[13px]", active ? "text-ink-muted" : "text-ink-faint")}>
          {description}
        </p>
      </div>
      {actions}
      <Switch checked={active} onCheckedChange={onToggle} />
    </div>
  );
}
