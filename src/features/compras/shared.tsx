import { useState, type ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ItemView } from "@/types";
import { CmButton, CmDialog, CmDialogContent, CmDialogDescription, CmDialogFooter, CmDialogTitle } from "./ui";

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
        "flex shrink-0 items-center justify-center overflow-hidden rounded-none bg-cm-card",
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
        <ImageOff aria-hidden className="text-cm-muted" style={{ width: size * 0.4, height: size * 0.4 }} />
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
