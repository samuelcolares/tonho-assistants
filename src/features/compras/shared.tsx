import { useState, type ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ImageOff } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ItemView } from "@/types";
import { CmButton, CmDialog, CmDialogContent, CmDialogDescription, CmDialogFooter, CmDialogTitle } from "./ui";

/** Label + control stack used by every form in the module. */
export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11.5px] text-ink-faint">{hint}</p>}
    </div>
  );
}

/** Item image with placeholder fallback (also when the file fails to load). */
export function ItemThumb({
  view,
  size = 40,
  className,
}: {
  view: ItemView;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = view.imageFile ? `${convertFileSrc(view.imageFile)}?v=${encodeURIComponent(view.item.updatedAt)}` : null;
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-bg-200",
        className
      )}
      style={{ width: size, height: size }}
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <ImageOff className="text-ink-faint" style={{ width: size * 0.4, height: size * 0.4 }} />
      )}
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Destructive confirmation dialog (Compras look). */
export function ConfirmDialog({ open, title, description, confirmLabel, busy, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <CmDialog open={open} onOpenChange={(o) => !o && !busy && onCancel()}>
      <CmDialogContent className="max-w-md">
        <div className="flex flex-col gap-2 pr-8">
          <CmDialogTitle>{title}</CmDialogTitle>
          <CmDialogDescription>{description}</CmDialogDescription>
        </div>
        <CmDialogFooter>
          <CmButton onClick={onCancel} disabled={busy}>
            Cancelar
          </CmButton>
          <CmButton variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Aguarde…" : confirmLabel}
          </CmButton>
        </CmDialogFooter>
      </CmDialogContent>
    </CmDialog>
  );
}

/** Small colored stat used inside cards. */
export function Money({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-ink">{value}</span>
    </div>
  );
}
