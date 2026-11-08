import { useEffect, useState } from "react";
import { comprasAddManualPrice, comprasUpsertOffer } from "@/api";
import { useToast } from "@/hooks/use-toast";
import type { OfferView } from "@/types";
import { errorMessage } from "./format";
import { toOffer } from "./offerActions";
import {
  CmBrlInput,
  CmButton,
  CmCheckbox,
  CmDialog,
  CmDialogContent,
  CmDialogDescription,
  CmDialogFooter,
  CmDialogTitle,
  CmField,
  CmInput,
} from "./ui";

interface BaseProps {
  open: boolean;
  offer: OfferView;
  onClose: () => void;
  onDone: () => void;
}

/** Records a typed price observation for an offer (always confirmed, source "manual"). */
export function ManualPriceDialog({ open, offer, onClose, onDone }: BaseProps) {
  const { toast } = useToast();
  const [list, setList] = useState<number | null>(null);
  const [cash, setCash] = useState<number | null>(null);
  const [inStock, setInStock] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setList(offer.latest?.listCents ?? null);
    setCash(offer.latest?.cashCents ?? null);
    setInStock(offer.latest?.inStock ?? true);
  }, [open, offer]);

  const submit = async () => {
    setBusy(true);
    try {
      await comprasAddManualPrice(offer.id, list, cash, inStock);
      toast({ variant: "success", title: "Preço registrado", description: offer.store });
      onDone();
      onClose();
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível registrar", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <CmDialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <CmDialogContent className="max-w-md">
        <div className="flex flex-col gap-2 pr-8">
          <CmDialogTitle>Preço digitado · {offer.store}</CmDialogTitle>
          <CmDialogDescription>Registra o preço que você viu na loja agora.</CmDialogDescription>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <CmField label="Preço cheio" htmlFor="manual-list">
            <CmBrlInput id="manual-list" value={list} onChange={setList} autoFocus />
          </CmField>
          <CmField label="Preço Pix / à vista" htmlFor="manual-cash">
            <CmBrlInput id="manual-cash" value={cash} onChange={setCash} />
          </CmField>
          <CmCheckbox checked={inStock} onChange={setInStock} className="sm:col-span-2">
            Em estoque
          </CmCheckbox>
        </div>
        <CmDialogFooter>
          <CmButton onClick={onClose} disabled={busy}>
            Cancelar
          </CmButton>
          <CmButton variant="strong" onClick={submit} disabled={busy || (list == null && cash == null)}>
            {busy ? "Salvando…" : "Registrar preço"}
          </CmButton>
        </CmDialogFooter>
      </CmDialogContent>
    </CmDialog>
  );
}

/** Edits offer metadata: store name, link, title, Pix discount, shipping note and pause. */
export function OfferEditDialog({ open, offer, onClose, onDone }: BaseProps) {
  const { toast } = useToast();
  const [store, setStore] = useState("");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [pix, setPix] = useState("");
  const [shipNote, setShipNote] = useState("");
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStore(offer.store);
    setUrl(offer.url ?? "");
    setTitle(offer.title ?? "");
    setPix(offer.pixDiscountPct != null ? String(offer.pixDiscountPct) : "");
    setShipNote(offer.shippingNote ?? "");
    setPaused(offer.status === "paused");
  }, [open, offer]);

  const submit = async () => {
    setBusy(true);
    try {
      const pct = pix.trim() === "" ? null : Number(pix.replace(",", "."));
      const wasPaused = offer.status === "paused";
      const status = paused ? "paused" : wasPaused ? (offer.adapter === "manual" ? "manual" : "pending") : offer.status;
      await comprasUpsertOffer({
        ...toOffer(offer),
        store: store.trim() || offer.store,
        url: url.trim() || null,
        title: title.trim() || null,
        pixDiscountPct: pct != null && Number.isFinite(pct) ? pct : null,
        shippingNote: shipNote.trim() || null,
        status,
      });
      toast({ variant: "success", title: "Loja atualizada" });
      onDone();
      onClose();
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível salvar", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <CmDialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <CmDialogContent aria-describedby={undefined}>
        <CmDialogTitle className="pr-8">Editar loja</CmDialogTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <CmField label="Loja" htmlFor="offer-store">
            <CmInput id="offer-store" value={store} onChange={(e) => setStore(e.target.value)} />
          </CmField>
          <CmField label="Desconto Pix (%)" htmlFor="offer-pix" hint="Vazio usa o padrão da loja.">
            <CmInput id="offer-pix" inputMode="decimal" value={pix} onChange={(e) => setPix(e.target.value)} placeholder="Ex.: 5" />
          </CmField>
          <CmField label="Link" htmlFor="offer-url" className="sm:col-span-2">
            <CmInput id="offer-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </CmField>
          <CmField label="Título na loja" htmlFor="offer-title" className="sm:col-span-2">
            <CmInput id="offer-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </CmField>
          <CmField label="Observação do frete" htmlFor="offer-ship-note" className="sm:col-span-2">
            <CmInput id="offer-ship-note" value={shipNote} onChange={(e) => setShipNote(e.target.value)} placeholder="Ex.: 7 dias" />
          </CmField>
          <CmCheckbox checked={paused} onChange={setPaused} className="sm:col-span-2">
            Pausar a verificação desta loja
          </CmCheckbox>
        </div>
        <CmDialogFooter>
          <CmButton onClick={onClose} disabled={busy}>
            Cancelar
          </CmButton>
          <CmButton variant="strong" onClick={submit} disabled={busy}>
            {busy ? "Salvando…" : "Salvar"}
          </CmButton>
        </CmDialogFooter>
      </CmDialogContent>
    </CmDialog>
  );
}
