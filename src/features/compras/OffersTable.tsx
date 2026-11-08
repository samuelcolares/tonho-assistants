import { useEffect, useState, type ReactNode } from "react";
import { ExternalLink, MoreHorizontal, Plus } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { comprasDeleteOffer, comprasRefresh, comprasUpsertOffer } from "@/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { OfferView } from "@/types";
import { errorMessage, formatRelative } from "./format";
import { CmTag } from "./ItemBadges";
import { STATUS_INFO } from "./labels";
import { formatBRL } from "./money";
import { ManualPriceDialog, OfferEditDialog } from "./OfferDialogs";
import { toOffer } from "./offerActions";
import { ConfirmDialog } from "./shared";
import {
  CmBrlInput,
  CmButton,
  CmIconButton,
  CmMenu,
  CmMenuContent,
  CmMenuItem,
  CmMenuSeparator,
  CmMenuTrigger,
} from "./ui";

const CASH_LABEL = { page: "Pix na página", estimated: "Pix estimado", list: "preço cheio" } as const;

/** Wide row: store | Pix | frete | final | status | menu (fixed 524 px + gaps; store gets the rest). */
const WIDE_COLS = "minmax(0,1fr) 108px 176px 112px 108px 32px";

interface OffersTableProps {
  offers: OfferView[];
  bestId: string | null;
  /** Narrow layout (two lines per store) for small windows. */
  narrow?: boolean;
  onAdd: () => void;
  onChanged: () => void;
}

/** "Lojas" list: hairline rows with link, Pix, inline frete, final price, status and a row menu. */
export function OffersTable({ offers, bestId, narrow = false, onAdd, onChanged }: OffersTableProps) {
  return (
    <div className="flex flex-col gap-5">
      {offers.length === 0 ? (
        <div className="flex flex-col items-start gap-4 border border-dashed border-cm-hairline p-6">
          <p className="text-[14px] font-light text-cm-body">Nenhuma loja ainda. Cole o link de uma loja ou digite um preço.</p>
          <CmButton onClick={onAdd}>
            <Plus className="h-4 w-4" /> Colar link
          </CmButton>
        </div>
      ) : (
        <>
          <div>
            {!narrow && (
              <div
                className="grid items-end gap-x-3 border-b border-cm-hairline px-2 pb-2 text-[11px] font-bold uppercase tracking-[1.5px] text-cm-muted"
                style={{ gridTemplateColumns: WIDE_COLS }}
                aria-hidden
              >
                <span>Loja</span>
                <span>Pix / à vista</span>
                <span>Frete</span>
                <span className="text-right">Final</span>
                <span>Status</span>
                <span />
              </div>
            )}
            <ul>
              {offers.map((o) => (
                <OfferRow key={o.id} offer={o} isBest={o.id === bestId} narrow={narrow} onChanged={onChanged} />
              ))}
            </ul>
          </div>
          <CmButton className="w-fit" onClick={onAdd}>
            <Plus className="h-4 w-4" /> Colar link
          </CmButton>
        </>
      )}
    </div>
  );
}

function OfferRow({ offer, isBest, narrow, onChanged }: { offer: OfferView; isBest: boolean; narrow: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const [shipping, setShipping] = useState<number | null>(offer.shippingCents);
  const [manualOpen, setManualOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const st = STATUS_INFO[offer.status];

  // Pick up frete changes made elsewhere (edit dialog, refresh).
  useEffect(() => setShipping(offer.shippingCents), [offer.shippingCents]);

  const run = async (fn: () => Promise<unknown>, okMsg?: string) => {
    try {
      await fn();
      if (okMsg) toast({ title: okMsg });
      onChanged();
    } catch (e) {
      toast({ variant: "danger", title: "Algo deu errado", description: errorMessage(e) });
    }
  };

  const saveShipping = (cents: number | null, note: string | null) => {
    if (cents === offer.shippingCents && note === offer.shippingNote) return;
    run(() => comprasUpsertOffer({ ...toOffer(offer), shippingCents: cents, shippingNote: note }));
  };

  const setFree = () => {
    setShipping(0);
    saveShipping(0, "grátis");
  };

  const openOffer = () => {
    if (offer.url) run(() => openUrl(offer.url!));
  };

  const storeCell = (
    <div className="flex min-w-0 flex-col gap-0.5">
      {offer.url ? (
        <button
          type="button"
          onClick={openOffer}
          title="Abrir a loja no navegador"
          className="group inline-flex max-w-full min-w-0 items-center gap-1.5 self-start text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cm-ink"
        >
          <span className="truncate text-[15px] font-bold text-cm-ink group-hover:underline">{offer.store}</span>
          <ExternalLink className="h-3.5 w-3.5 shrink-0 text-cm-muted group-hover:text-cm-ink" aria-hidden />
        </button>
      ) : (
        <span className="truncate text-[15px] font-bold text-cm-ink">{offer.store}</span>
      )}
      {offer.title && (
        <span className="line-clamp-1 text-[12px] font-light text-cm-muted" title={offer.title}>
          {offer.title}
        </span>
      )}
      {offer.lastError && (
        <span className="line-clamp-2 text-[12px] font-light text-cm-danger" title={offer.lastError}>
          {offer.lastError}
        </span>
      )}
      {offer.latest?.inStock === false && <span className="text-[12px] font-bold text-cm-warn">Sem estoque</span>}
    </div>
  );

  const pixCell = (
    <div className="flex min-w-0 flex-col" title={offer.latest?.listCents != null ? `Preço cheio: ${formatBRL(offer.latest.listCents)}` : undefined}>
      <span className="text-[14px] font-bold tabular-nums text-cm-ink">{formatBRL(offer.effectiveCashCents)}</span>
      {offer.cashSource && <span className="truncate text-[12px] font-light text-cm-muted">{CASH_LABEL[offer.cashSource]}</span>}
    </div>
  );

  const shipCell = (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <div className="w-[92px] shrink-0">
          <CmBrlInput
            size="sm"
            value={shipping}
            onChange={setShipping}
            placeholder="?"
            aria-label={`Frete ${offer.store}`}
            onCommit={(c) => saveShipping(c, c !== 0 && offer.shippingNote === "grátis" ? null : offer.shippingNote)}
          />
        </div>
        <button
          type="button"
          onClick={setFree}
          title="Marcar frete grátis"
          className="h-9 px-1 text-[11px] font-bold uppercase tracking-[1px] text-cm-muted hover:text-cm-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-cm-ink"
        >
          grátis
        </button>
      </div>
      {!offer.shippingKnown ? (
        <span className="text-[11px] font-bold text-cm-warn">frete desconhecido</span>
      ) : (
        offer.shippingNote && <span className="truncate text-[11px] font-light text-cm-muted">{offer.shippingNote}</span>
      )}
    </div>
  );

  const finalCell = (
    <div className="flex min-w-0 flex-col items-end">
      <span className={cn("text-[18px] font-bold tabular-nums", isBest ? "text-cm-accent" : "text-cm-ink")}>{formatBRL(offer.finalCents)}</span>
      <span className="truncate text-[11px] font-light text-cm-muted">
        {isBest ? "melhor · " : ""}
        {formatRelative(offer.lastCheckedAt ?? offer.latest?.lastSeenAt)}
      </span>
    </div>
  );

  const statusCell = (
    <div className="flex min-w-0 items-center">
      <CmTag variant={st.variant} title={offer.lastError ? `${st.hint}. ${offer.lastError}` : st.hint}>
        {st.label}
      </CmTag>
    </div>
  );

  const menu: ReactNode = (
    <CmMenu>
      <CmMenuTrigger asChild>
        <CmIconButton size="sm" className="border-transparent bg-transparent" aria-label={`Mais ações da ${offer.store}`}>
          <MoreHorizontal className="h-4 w-4" />
        </CmIconButton>
      </CmMenuTrigger>
      <CmMenuContent>
        {offer.url && <CmMenuItem onSelect={openOffer}>Abrir na loja</CmMenuItem>}
        {offer.adapter !== "manual" && offer.status !== "blocked" && (
          <CmMenuItem onSelect={() => run(() => comprasRefresh(null, offer.id), "Atualização pedida")}>Atualizar agora</CmMenuItem>
        )}
        <CmMenuItem onSelect={() => setManualOpen(true)}>Informar preço digitado</CmMenuItem>
        <CmMenuItem onSelect={() => setEditOpen(true)}>Editar loja ou link</CmMenuItem>
        <CmMenuSeparator />
        <CmMenuItem danger onSelect={() => setDeleteOpen(true)}>
          Remover loja
        </CmMenuItem>
      </CmMenuContent>
    </CmMenu>
  );

  return (
    <li className={cn("border-b border-cm-hairline px-2 py-4", isBest && "bg-cm-soft", offer.status === "paused" && "opacity-60")}>
      {narrow ? (
        <div className="flex flex-col gap-3">
          <div className="grid items-start gap-x-3" style={{ gridTemplateColumns: "minmax(0,1fr) auto 32px" }}>
            {storeCell}
            {finalCell}
            {menu}
          </div>
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
            <LabeledCell label="Pix / à vista">{pixCell}</LabeledCell>
            <LabeledCell label="Frete">{shipCell}</LabeledCell>
            <LabeledCell label="Status">{statusCell}</LabeledCell>
          </div>
        </div>
      ) : (
        <div className="grid items-center gap-x-3" style={{ gridTemplateColumns: WIDE_COLS }}>
          {storeCell}
          {pixCell}
          {shipCell}
          {finalCell}
          {statusCell}
          {menu}
        </div>
      )}

      <ManualPriceDialog open={manualOpen} offer={offer} onClose={() => setManualOpen(false)} onDone={onChanged} />
      <OfferEditDialog open={editOpen} offer={offer} onClose={() => setEditOpen(false)} onDone={onChanged} />
      <ConfirmDialog
        open={deleteOpen}
        title="Remover loja?"
        description={`A loja ${offer.store} e o histórico de preços dela serão apagados.`}
        confirmLabel="Remover"
        busy={busy}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={async () => {
          setBusy(true);
          await run(() => comprasDeleteOffer(offer.id), "Loja removida");
          setBusy(false);
          setDeleteOpen(false);
        }}
      />
    </li>
  );
}

function LabeledCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-bold uppercase tracking-[1.5px] text-cm-muted">{label}</span>
      {children}
    </div>
  );
}
