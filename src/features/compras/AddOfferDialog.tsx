import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "./format";
import { createOfferFromDraft } from "./offerActions";
import { draftIsValid, OfferSourceForm, type OfferDraft } from "./OfferSourceForm";
import { CmButton, CmDialog, CmDialogContent, CmDialogDescription, CmDialogFooter, CmDialogTitle } from "./ui";

interface AddOfferDialogProps {
  open: boolean;
  itemId: string;
  itemName: string;
  onClose: () => void;
  onDone: () => void;
}

/** Adds a store to an existing item: by store link (with preview) or typed manually. */
export function AddOfferDialog({ open, itemId, itemName, onClose, onDone }: AddOfferDialogProps) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<OfferDraft | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setDraft(null);
  }, [open]);

  const submit = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await createOfferFromDraft(itemId, draft);
      toast({ variant: "success", title: "Loja adicionada" });
      onDone();
      onClose();
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível adicionar a loja", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <CmDialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <CmDialogContent className="max-w-xl">
        <div className="flex flex-col gap-2 pr-8">
          <CmDialogTitle>Colar link</CmDialogTitle>
          <CmDialogDescription className="line-clamp-1">{itemName}</CmDialogDescription>
        </div>
        {/* The source form is shared with "add item" and is restyled with that screen (P9). */}
        <OfferSourceForm draft={draft} onChange={setDraft} />
        <CmDialogFooter>
          <CmButton onClick={onClose} disabled={busy}>
            Cancelar
          </CmButton>
          <CmButton variant="strong" onClick={submit} disabled={busy || !draftIsValid(draft)}>
            {busy ? "Salvando…" : "Adicionar loja"}
          </CmButton>
        </CmDialogFooter>
      </CmDialogContent>
    </CmDialog>
  );
}
