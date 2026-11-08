import { useEffect, useState } from "react";
import { comprasAddManualPrice, comprasUpsertOffer } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { OfferView } from "@/types";
import { BrlInput } from "./BrlInput";
import { errorMessage } from "./format";
import { toOffer } from "./offerActions";
import { Field } from "./shared";

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
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Preço manual · {offer.store}</DialogTitle>
          <DialogDescription>Registra o preço que você viu na loja agora.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Preço cheio">
            <BrlInput value={list} onChange={setList} autoFocus />
          </Field>
          <Field label="Preço Pix / à vista">
            <BrlInput value={cash} onChange={setCash} />
          </Field>
          <label className="col-span-2 flex items-center gap-2 text-[13px] text-ink-muted">
            <Switch checked={inStock} onCheckedChange={setInStock} /> Em estoque
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy || (list == null && cash == null)}>
            {busy ? "Salvando…" : "Registrar preço"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Edits offer metadata: store name, link, title, Pix discount and pause. */
export function OfferEditDialog({ open, offer, onClose, onDone }: BaseProps) {
  const { toast } = useToast();
  const [store, setStore] = useState("");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [pix, setPix] = useState("");
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStore(offer.store);
    setUrl(offer.url ?? "");
    setTitle(offer.title ?? "");
    setPix(offer.pixDiscountPct != null ? String(offer.pixDiscountPct) : "");
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
        status,
      });
      toast({ variant: "success", title: "Oferta atualizada" });
      onDone();
      onClose();
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível salvar", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar oferta</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Loja">
            <Input value={store} onChange={(e) => setStore(e.target.value)} />
          </Field>
          <Field label="Desconto Pix (%)" hint="Vazio usa o padrão da loja.">
            <Input inputMode="decimal" value={pix} onChange={(e) => setPix(e.target.value)} placeholder="Ex.: 5" />
          </Field>
          <Field label="Link" className="col-span-2">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Título na loja" className="col-span-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <label className="col-span-2 flex items-center gap-2 text-[13px] text-ink-muted">
            <Switch checked={paused} onCheckedChange={setPaused} /> Pausar verificação desta oferta
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
