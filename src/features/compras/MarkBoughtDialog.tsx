import { useEffect, useState } from "react";
import { comprasMarkBought } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { ItemView } from "@/types";
import { BrlInput } from "./BrlInput";
import { dateInputToIso, errorMessage, todayInputValue } from "./format";
import { formatBRL } from "./money";
import { Field } from "./shared";

interface MarkBoughtDialogProps {
  view: ItemView | null;
  onClose: () => void;
  onDone: () => void;
}

/** Records a purchase. Prefilled from the best current offer, then the budget. */
export function MarkBoughtDialog({ view, onClose, onDone }: MarkBoughtDialogProps) {
  const { toast } = useToast();
  const [paid, setPaid] = useState<number | null>(null);
  const [shipping, setShipping] = useState<number | null>(0);
  const [store, setStore] = useState("");
  const [date, setDate] = useState(todayInputValue());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const itemId = view?.item.id;
  useEffect(() => {
    if (!view) return;
    // The best offer's final price already includes its frete, so shipping starts at 0.
    const best = view.best;
    setPaid(best?.finalCents ?? view.item.budgetUnitCents);
    setShipping(0);
    setStore(best?.store ?? "");
    setDate(todayInputValue());
    setNotes("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  const submit = async () => {
    if (!view || paid == null) return;
    setBusy(true);
    try {
      await comprasMarkBought({
        itemId: view.item.id,
        paidUnitCents: paid,
        shippingCents: shipping ?? 0,
        store: store.trim(),
        purchasedAt: dateInputToIso(date),
        notes: notes.trim(),
      });
      toast({ variant: "success", title: "Marcado como comprado", description: view.item.name });
      onDone();
      onClose();
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível marcar como comprado", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const qty = view ? (view.item.qty > 0 ? view.item.qty : 1) : 1;
  const total = paid != null ? paid * qty + (shipping ?? 0) : null;

  return (
    <Dialog open={view != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {view && (
          <>
            <DialogHeader>
              <DialogTitle>Marcar como comprado</DialogTitle>
              <DialogDescription className="line-clamp-2">{view.item.name}</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Preço pago (un.)">
                <BrlInput value={paid} onChange={setPaid} autoFocus />
              </Field>
              <Field label="Frete à parte (total)" hint="O preço sugerido já inclui o frete da oferta.">
                <BrlInput value={shipping} onChange={setShipping} />
              </Field>
              <Field label="Loja">
                <Input value={store} onChange={(e) => setStore(e.target.value)} placeholder="Ex.: KaBuM" />
              </Field>
              <Field label="Data da compra">
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Observações" className="col-span-2">
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </Field>
            </div>
            {total != null && (
              <p className="text-[13px] text-ink-muted">
                Total desta compra ({qty} un. + frete):{" "}
                <strong className="tabular-nums text-ink">{formatBRL(total)}</strong>
              </p>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Cancelar
              </Button>
              <Button onClick={submit} disabled={busy || paid == null}>
                {busy ? "Salvando…" : "Confirmar compra"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
