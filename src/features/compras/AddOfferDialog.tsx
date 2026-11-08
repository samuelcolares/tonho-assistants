import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "./format";
import { createOfferFromDraft } from "./offerActions";
import { draftIsValid, OfferSourceForm, type OfferDraft } from "./OfferSourceForm";

interface AddOfferDialogProps {
  open: boolean;
  itemId: string;
  itemName: string;
  onClose: () => void;
  onDone: () => void;
}

/** Adds an offer to an existing item: by store link (with preview) or typed manually. */
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
      toast({ variant: "success", title: "Oferta adicionada" });
      onDone();
      onClose();
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível adicionar a oferta", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Adicionar oferta</DialogTitle>
          <DialogDescription className="line-clamp-1">{itemName}</DialogDescription>
        </DialogHeader>
        <OfferSourceForm draft={draft} onChange={setDraft} />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy || !draftIsValid(draft)}>
            {busy ? "Salvando…" : "Adicionar oferta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
