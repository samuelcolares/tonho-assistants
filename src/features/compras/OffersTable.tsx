import { useState } from "react";
import { DollarSign, ExternalLink, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { comprasDeleteOffer, comprasRefresh, comprasUpsertOffer } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { OfferStatus, OfferView } from "@/types";
import { BrlInput } from "./BrlInput";
import { errorMessage, formatRelative } from "./format";
import { formatBRL } from "./money";
import { ConfirmDialog } from "./shared";
import { toOffer } from "./offerActions";
import { ManualPriceDialog, OfferEditDialog } from "./OfferDialogs";

const STATUS: Record<OfferStatus, { label: string; variant: "default" | "success" | "warning" | "danger" }> = {
  ok: { label: "OK", variant: "success" },
  pending: { label: "Aguardando", variant: "default" },
  manual: { label: "Manual", variant: "default" },
  suspect: { label: "Suspeito", variant: "warning" },
  blocked: { label: "Bloqueado", variant: "danger" },
  broken: { label: "Quebrado", variant: "danger" },
  paused: { label: "Pausada", variant: "default" },
};

const CASH_LABEL = { page: "Pix na página", estimated: "Pix estimado", list: "preço cheio" } as const;

interface OffersTableProps {
  offers: OfferView[];
  bestId: string | null;
  onAdd: () => void;
  onChanged: () => void;
}

export function OffersTable({ offers, bestId, onAdd, onChanged }: OffersTableProps) {
  return (
    <div className="flex flex-col gap-3">
      {offers.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-8 text-center">
          <p className="text-sm text-ink-muted">Nenhuma oferta ainda. Cole o link de uma loja ou informe um preço manualmente.</p>
          <Button variant="secondary" onClick={onAdd}>
            <Plus className="h-4 w-4" /> Adicionar oferta
          </Button>
        </div>
      ) : (
        <div className="flex flex-col">
          {offers.map((o) => (
            <OfferRow key={o.id} offer={o} isBest={o.id === bestId} onChanged={onChanged} />
          ))}
        </div>
      )}
      {offers.length > 0 && (
        <Button variant="secondary" size="sm" className="w-fit" onClick={onAdd}>
          <Plus className="h-4 w-4" /> Adicionar oferta
        </Button>
      )}
    </div>
  );
}

function OfferRow({ offer, isBest, onChanged }: { offer: OfferView; isBest: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const [shipping, setShipping] = useState<number | null>(offer.shippingCents);
  const [note, setNote] = useState(offer.shippingNote ?? "");
  const [manualOpen, setManualOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const st = STATUS[offer.status];

  const run = async (fn: () => Promise<unknown>, okMsg?: string) => {
    try {
      await fn();
      if (okMsg) toast({ title: okMsg });
      onChanged();
    } catch (e) {
      toast({ variant: "danger", title: "Algo deu errado", description: errorMessage(e) });
    }
  };

  const saveShipping = (cents: number | null, newNote: string) => {
    const noteVal = newNote.trim() || null;
    if (cents === offer.shippingCents && noteVal === offer.shippingNote) return;
    run(() => comprasUpsertOffer({ ...toOffer(offer), shippingCents: cents, shippingNote: noteVal }));
  };

  const setFree = () => {
    setShipping(0);
    setNote("grátis");
    saveShipping(0, "grátis");
  };

  const openOffer = () => {
    if (offer.url) run(() => openUrl(offer.url!));
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-border px-2 py-3 last:border-b-0",
        isBest && "bg-compras-subtle/40",
        offer.status === "paused" && "opacity-60"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div
          className={cn("flex min-w-0 flex-col gap-1", offer.url && "group cursor-pointer")}
          role={offer.url ? "link" : undefined}
          tabIndex={offer.url ? 0 : undefined}
          title={offer.url ? "Abrir oferta no navegador" : undefined}
          onClick={openOffer}
          onKeyDown={(e) => {
            if (e.key === "Enter") openOffer();
          }}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <strong className="text-[13px] text-ink group-hover:text-compras group-hover:underline">{offer.store}</strong>
            {offer.url && <ExternalLink className="h-3.5 w-3.5 text-ink-faint group-hover:text-compras" />}
            <Badge variant={st.variant} title={offer.lastError ?? undefined} className="text-[10.5px]">
              {st.label}
            </Badge>
            {isBest && <Badge variant="success" className="text-[10.5px]">Melhor</Badge>}
          </div>
          {offer.title && (
            <span className="line-clamp-2 text-[11.5px] text-ink-muted group-hover:text-ink" title={offer.title}>
              {offer.title}
            </span>
          )}
          {offer.lastError && <span className="line-clamp-2 text-[11px] text-danger" title={offer.lastError}>{offer.lastError}</span>}
          {offer.latest?.inStock === false && <span className="text-[11px] font-semibold text-warning">Sem estoque</span>}
        </div>

        <div className="flex shrink-0 flex-col items-end">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">Final</span>
          <span className={cn("text-[18px] font-bold tabular-nums", isBest ? "text-compras" : "text-ink")}>
            {formatBRL(offer.finalCents)}
          </span>
          <span className="text-[10.5px] text-ink-faint">verificado {formatRelative(offer.lastCheckedAt ?? offer.latest?.lastSeenAt)}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <Field label="Preço cheio">
          <span className="text-[13px] tabular-nums text-ink-muted">{formatBRL(offer.latest?.listCents)}</span>
        </Field>
        <Field label="Pix / à vista">
          <span className="text-[13px] font-medium tabular-nums text-ink">
            {formatBRL(offer.effectiveCashCents)}
            {offer.cashSource && <span className="ml-1.5 text-[10.5px] font-normal text-ink-faint">{CASH_LABEL[offer.cashSource]}</span>}
          </span>
        </Field>
        <Field label={offer.shippingKnown ? "Frete" : "Frete (desconhecido)"} warn={!offer.shippingKnown}>
          <div className="flex items-center gap-1">
            <div className="w-[100px]">
              <BrlInput
                value={shipping}
                onChange={setShipping}
                className="h-8 text-[13px]"
                placeholder="?"
                aria-label={`Frete ${offer.store}`}
                onCommit={(c) => saveShipping(c, note)}
              />
            </div>
            <Button size="sm" variant="ghost" className="h-8 px-2 text-[12px]" onClick={setFree} title="Frete grátis">
              grátis
            </Button>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => saveShipping(shipping, note)}
              placeholder="Obs. (ex.: 7 dias)"
              className="h-8 w-[130px] px-2 text-[12px]"
              aria-label={`Observação do frete ${offer.store}`}
            />
          </div>
        </Field>

        <div className="ml-auto flex items-center gap-0.5">
          {offer.url && (
            <Button size="icon" variant="ghost" title="Abrir na loja" aria-label="Abrir na loja" onClick={openOffer}>
              <ExternalLink className="h-4 w-4" />
            </Button>
          )}
          {offer.adapter !== "manual" && offer.status !== "blocked" && (
            <Button size="icon" variant="ghost" title="Atualizar agora" aria-label="Atualizar agora" onClick={() => run(() => comprasRefresh(null, offer.id), "Atualização pedida")}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
          <Button size="icon" variant="ghost" title="Informar preço manual" aria-label="Informar preço manual" onClick={() => setManualOpen(true)}>
            <DollarSign className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" title="Editar oferta" aria-label="Editar oferta" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" title="Remover oferta" aria-label="Remover oferta" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ManualPriceDialog open={manualOpen} offer={offer} onClose={() => setManualOpen(false)} onDone={onChanged} />
      <OfferEditDialog open={editOpen} offer={offer} onClose={() => setEditOpen(false)} onDone={onChanged} />
      <ConfirmDialog
        open={deleteOpen}
        title="Remover oferta?"
        description={`A oferta da ${offer.store} e seu histórico de preços serão apagados.`}
        confirmLabel="Remover"
        busy={busy}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={async () => {
          setBusy(true);
          await run(() => comprasDeleteOffer(offer.id), "Oferta removida");
          setBusy(false);
          setDeleteOpen(false);
        }}
      />
    </div>
  );
}

function Field({ label, warn, children }: { label: string; warn?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={cn("text-[10.5px] font-semibold uppercase tracking-wide", warn ? "text-warning" : "text-ink-faint")}>{label}</span>
      {children}
    </div>
  );
}
