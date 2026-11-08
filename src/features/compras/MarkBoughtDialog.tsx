import { useEffect, useState } from "react";
import { comprasMarkBought } from "@/api";
import { useToast } from "@/hooks/use-toast";
import type { ItemView } from "@/types";
import { dateInputToIso, errorMessage, todayInputValue } from "./format";
import { formatBRL } from "./money";
import {
  CmBrlInput,
  CmButton,
  CmDialog,
  CmDialogContent,
  CmDialogDescription,
  CmDialogFooter,
  CmDialogTitle,
  CmField,
  CmInput,
  CmTextarea,
} from "./ui";

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
    <CmDialog open={view != null} onOpenChange={(o) => !o && !busy && onClose()}>
      <CmDialogContent>
        {view && (
          <>
            <div className="flex flex-col gap-2 pr-8">
              <CmDialogTitle>Marcar como comprado</CmDialogTitle>
              <CmDialogDescription className="line-clamp-2">{view.item.name}</CmDialogDescription>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <CmField label="Preço pago (un.)" htmlFor="bought-paid">
                <CmBrlInput id="bought-paid" value={paid} onChange={setPaid} autoFocus />
              </CmField>
              <CmField label="Frete à parte (total)" htmlFor="bought-ship" hint="O preço sugerido já inclui o frete da loja.">
                <CmBrlInput id="bought-ship" value={shipping} onChange={setShipping} />
              </CmField>
              <CmField label="Loja" htmlFor="bought-store">
                <CmInput id="bought-store" value={store} onChange={(e) => setStore(e.target.value)} placeholder="Ex.: KaBuM" />
              </CmField>
              <CmField label="Data da compra" htmlFor="bought-date">
                <CmInput id="bought-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </CmField>
              <CmField label="Observações" htmlFor="bought-notes" className="sm:col-span-2">
                <CmTextarea id="bought-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </CmField>
            </div>
            {total != null && (
              <p className="text-[14px] font-light text-cm-body">
                Total desta compra ({qty} un. + frete): <strong className="font-bold tabular-nums text-cm-ink">{formatBRL(total)}</strong>
              </p>
            )}
            <CmDialogFooter>
              <CmButton onClick={onClose} disabled={busy}>
                Cancelar
              </CmButton>
              <CmButton variant="strong" onClick={submit} disabled={busy || paid == null}>
                {busy ? "Salvando…" : "Confirmar compra"}
              </CmButton>
            </CmDialogFooter>
          </>
        )}
      </CmDialogContent>
    </CmDialog>
  );
}
