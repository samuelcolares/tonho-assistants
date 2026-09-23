import { useRef, useState } from "react";
import { Check, Copy, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface VaultCardProps {
  label: string;
  content: string;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function VaultCard({ label, content, onEdit, onDelete }: VaultCardProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable — nothing to fall back to
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-bg-100 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold text-bonnie">{label}</span>
        <div className="flex shrink-0 gap-0.5">
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
      </div>

      <div className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all rounded-md border border-border bg-bg-000 p-3 font-mono text-[13px] text-ink">
        {content}
      </div>

      <Button
        size="sm"
        onClick={handleCopy}
        className={copied ? "bg-bg-200 text-ink hover:bg-bg-200" : undefined}
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5" /> Copiado
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" /> Copiar
          </>
        )}
      </Button>
    </div>
  );
}
