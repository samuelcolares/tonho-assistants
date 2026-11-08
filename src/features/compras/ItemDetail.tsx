import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Bell, Camera, ChevronDown, ChevronRight, MoreHorizontal, RefreshCw } from "lucide-react";
import {
  comprasDeleteItem,
  comprasGetItem,
  comprasRefresh,
  comprasSnoozeAlert,
  comprasUnmarkBought,
  onComprasUpdated,
} from "@/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { CategoryTemplate, ItemView } from "@/types";
import { AddOfferDialog } from "./AddOfferDialog";
import { AlertDialog } from "./AlertDialog";
import { alertStatus } from "./alertCalc";
import { adviceFor, bestCaption, isSnoozed, lastAlertText, priorityLabel, snoozeUntilIso } from "./detailCalc";
import { errorMessage, formatDateTime, formatDay } from "./format";
import { ImageDialog } from "./ImageDialog";
import { ItemForm } from "./ItemForm";
import { MarkBoughtDialog } from "./MarkBoughtDialog";
import { OffersTable } from "./OffersTable";
import { PriceChart } from "./PriceChart";
import { RangeBar } from "./RangeBar";
import { ConfirmDialog, ItemThumb } from "./shared";
import { SpecsForm } from "./SpecsForm";
import { StatsPanel } from "./StatsPanel";
import { formatBRL } from "./money";
import { useContainerWidth } from "./useContainerWidth";
import { useItemAutosave, type SaveStatus } from "./useItemAutosave";
import {
  CmButton,
  CmField,
  CmIconButton,
  CmMenu,
  CmMenuContent,
  CmMenuItem,
  CmMenuSeparator,
  CmMenuTrigger,
  CmSelect,
  VerdictChip,
} from "./ui";

/** Below this content width the detail stacks its columns (668 px at the 900 px minimum window). */
const NARROW_MAX = 760;

interface ItemDetailProps {
  id: string;
  templates: CategoryTemplate[];
  categories: string[];
  onBack: () => void;
  /** Called after any change so the list/dashboard can refresh. */
  onChanged: () => void;
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-5">
      <div className="flex items-center justify-between gap-3 border-b border-cm-hairline pb-3">
        <h2 className="text-[13px] font-bold uppercase tracking-[1.5px] text-cm-ink">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

const Eyebrow = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={cn("text-[12px] font-bold uppercase tracking-[1.5px] text-cm-muted", className)}>{children}</span>
);

/** "SALVANDO…" / "SALVO" / "ERRO AO SALVAR — TENTAR DE NOVO" (click retries). */
function SaveIndicator({ status, detail, onRetry }: { status: SaveStatus; detail: string | null; onRetry: () => void }) {
  return (
    <div className="flex min-h-6 items-center text-[12px] font-bold uppercase tracking-[1.5px]" role="status" aria-live="polite">
      {status === "saving" && <span className="text-cm-muted">Salvando…</span>}
      {status === "saved" && <span className="text-cm-accent">Salvo</span>}
      {status === "error" && (
        <button
          type="button"
          onClick={onRetry}
          title={detail ?? undefined}
          className="text-left uppercase text-cm-danger hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cm-ink"
        >
          Erro ao salvar — tentar de novo
          {detail && <span className="ml-1 font-light normal-case tracking-normal"> ({detail})</span>}
        </button>
      )}
    </div>
  );
}

export function ItemDetail({ id, templates, categories, onBack, onChanged }: ItemDetailProps) {
  const { toast } = useToast();
  const [rootRef, width] = useContainerWidth<HTMLDivElement>();
  const narrow = width < NARROW_MAX;
  const [view, setView] = useState<ItemView | null>(null);
  const [imageOpen, setImageOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [boughtOpen, setBoughtOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [snoozing, setSnoozing] = useState(false);
  const backTries = useRef(0);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const load = useCallback(async () => {
    try {
      setView(await comprasGetItem(id));
    } catch (e) {
      toast({ variant: "danger", title: "Item não encontrado", description: errorMessage(e) });
      onBack();
    }
  }, [id, onBack, toast]);

  useEffect(() => {
    load();
    const un = onComprasUpdated((itemId) => {
      if (itemId == null || itemId === id) load();
    });
    return () => {
      un.then((fn) => fn()).catch(() => {});
    };
  }, [id, load]);

  const auto = useItemAutosave(id, view?.item ?? null, (saved) => {
    setView((v) => (v ? { ...v, item: saved } : v));
    void load();
    onChangedRef.current();
  });

  const changed = useCallback(async () => {
    await load();
    onChanged();
  }, [load, onChanged]);

  const item = auto.item;
  if (!view || !item) {
    return (
      <div ref={rootRef}>
        <p className="py-12 text-center text-sm font-light text-cm-muted">Carregando item…</p>
      </div>
    );
  }

  const template = templates.find((t) => t.id === item.templateId) ?? null;
  const a = alertStatus(view);
  const snoozed = isSnoozed(view.alert);
  const bought = view.item.bought;
  const best = view.best;
  const reached = !bought && a.on && a.reached;
  const advice = adviceFor(view);
  const specsLine = Object.values(item.specs)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5)
    .join(" · ");

  const goBack = async () => {
    const ok = await auto.flush(true);
    if (!ok && backTries.current === 0) {
      backTries.current = 1;
      toast({
        variant: "warning",
        title: "Há alterações sem salvar",
        description: "Veja o aviso no topo. Clique em voltar de novo para sair mesmo assim.",
      });
      return;
    }
    onBack();
  };

  const refresh = async () => {
    try {
      await comprasRefresh(id, null);
      toast({ title: "Atualização pedida", description: "Os preços aparecem em instantes." });
    } catch (e) {
      toast({ variant: "danger", title: "Falha ao atualizar", description: errorMessage(e) });
    }
  };

  const unmark = async () => {
    try {
      await comprasUnmarkBought(id);
      toast({ title: "Compra desfeita" });
      await changed();
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível desfazer", description: errorMessage(e) });
    }
  };

  const snooze = async (until: string | null) => {
    setSnoozing(true);
    try {
      await comprasSnoozeAlert(id, until);
      toast({ title: until ? "Aviso silenciado por 7 dias" : "Aviso reativado" });
      await changed();
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível mudar o aviso", description: errorMessage(e) });
    } finally {
      setSnoozing(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    auto.discard();
    try {
      await comprasDeleteItem(id);
      toast({ title: "Item excluído", description: view.item.name });
      onChanged();
      onBack();
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível excluir", description: errorMessage(e) });
      setDeleting(false);
    }
  };

  const chartKey = `${view.item.updatedAt}|${view.offers.map((o) => `${o.id}:${o.latest?.lastSeenAt ?? ""}`).join(",")}`;
  const priceText = formatBRL(bought ? view.purchase?.paidUnitCents : best?.finalCents);
  const priceCls = priceText.length > 12 ? "text-[28px]" : "text-[36px]";
  const stripeCls = bought ? "bg-cm-hairline" : advice.tone === "good" || reached ? "bg-cm-accent" : advice.tone === "warn" ? "bg-cm-warn" : "bg-cm-hairline";
  const headlineCls = advice.tone === "good" ? "text-cm-accent" : advice.tone === "warn" ? "text-cm-warn" : "text-cm-ink";

  const imageCell = (
    <button
      type="button"
      onClick={() => setImageOpen(true)}
      title="Trocar imagem"
      aria-label="Trocar imagem"
      className="group relative block h-[200px] w-[200px] shrink-0 overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cm-ink"
    >
      <ItemThumb view={view} size={200} className="rounded-none border-0 bg-cm-card" />
      <span className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/60 text-[12px] font-bold uppercase tracking-[1.5px] text-cm-ink opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        <Camera className="h-4 w-4" /> Trocar
      </span>
    </button>
  );

  const priceCell = (
    <div className={cn("flex min-w-0 flex-col gap-2", narrow && "flex-1")}>
      <Eyebrow className="truncate">
        {bought ? `Pago${view.purchase?.store ? ` · ${view.purchase.store}` : ""}` : best ? `Melhor preço · ${best.store}` : "Melhor preço"}
      </Eyebrow>
      {bought || best?.finalCents != null ? (
        <span className={cn("whitespace-nowrap font-bold leading-none tabular-nums", priceCls, reached ? "text-cm-accent" : "text-cm-ink")}>{priceText}</span>
      ) : (
        <span className="text-[20px] font-bold leading-none text-cm-muted">Sem preço</span>
      )}
      <p className="text-[13px] font-light leading-5 text-cm-body">
        {bought ? (
          view.purchase && `em ${formatDay(view.purchase.purchasedAt)}`
        ) : best && best.finalCents != null ? (
          bestCaption(best).map((p, i) => (
            <span key={i} className={cn(p.warn && "font-bold text-cm-warn")}>
              {i > 0 && " · "}
              {p.text}
            </span>
          ))
        ) : (
          "Cole o link de uma loja"
        )}
      </p>
    </div>
  );

  return (
    <div ref={rootRef} className="flex min-w-0 flex-col gap-8">
      {/* Top bar: back link, save status, actions */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex h-10 items-center gap-2 text-[12px] font-bold uppercase tracking-[1.5px] text-cm-muted hover:text-cm-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cm-ink"
        >
          <ArrowLeft className="h-4 w-4" /> Itens
        </button>
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
          <SaveIndicator status={auto.status} detail={auto.errorText} onRetry={() => void auto.flush(true)} />
          <div className="flex items-center gap-2">
            <CmIconButton
              active={a.on && !bought && !snoozed}
              disabled={bought}
              aria-label={a.on ? "Editar aviso de preço" : "Avisar quando baixar"}
              title={bought ? "Item já comprado" : a.on ? "Aviso ligado" : "Avisar quando baixar"}
              onClick={() => setAlertOpen(true)}
            >
              <Bell className="h-4 w-4" />
            </CmIconButton>
            <CmButton onClick={refresh}>
              <RefreshCw className="h-4 w-4" /> Atualizar agora
            </CmButton>
            <CmMenu>
              <CmMenuTrigger asChild>
                <CmIconButton aria-label="Mais ações do item">
                  <MoreHorizontal className="h-4 w-4" />
                </CmIconButton>
              </CmMenuTrigger>
              <CmMenuContent>
                {bought ? (
                  <CmMenuItem onSelect={unmark}>Desfazer compra</CmMenuItem>
                ) : (
                  <CmMenuItem onSelect={() => setBoughtOpen(true)}>Marcar comprado</CmMenuItem>
                )}
                <CmMenuSeparator />
                <CmMenuItem danger onSelect={() => setDeleteOpen(true)}>
                  Excluir
                </CmMenuItem>
              </CmMenuContent>
            </CmMenu>
          </div>
        </div>
      </div>

      {view.purchase && (
        <div className="border-l-4 border-cm-accent bg-cm-card px-4 py-3 text-[14px] font-light text-cm-body-strong">
          Comprado em {formatDateTime(view.purchase.purchasedAt)}
          {view.purchase.store ? ` na ${view.purchase.store}` : ""} por{" "}
          <strong className="font-bold tabular-nums text-cm-ink">{formatBRL(view.purchase.paidUnitCents)}</strong>
          {view.purchase.shippingCents > 0 && ` + ${formatBRL(view.purchase.shippingCents)} de frete`}.
          {view.purchase.notes && <span className="text-cm-body"> {view.purchase.notes}</span>}
        </div>
      )}

      {/* HERO */}
      <div className={cn("grid border border-cm-hairline", narrow ? "grid-cols-[200px_minmax(0,1fr)]" : "grid-cols-[200px_minmax(0,1fr)_272px]")}>
        {imageCell}
        <div className="flex min-w-0 flex-col justify-between gap-5 p-6">
          <div className="flex min-w-0 flex-col gap-3">
            <Eyebrow className="truncate">
              {item.category || "Sem categoria"} · {priorityLabel(item.priority)}
            </Eyebrow>
            <h1 className="break-words text-[28px] font-bold uppercase leading-[1.15] text-cm-ink">{item.name || "Sem nome"}</h1>
            {specsLine && <p className="line-clamp-2 text-[14px] font-light leading-5 text-cm-body">{specsLine}</p>}
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <div aria-hidden className={cn("h-1 w-16", stripeCls)} />
            <p className="text-[14px] font-light leading-5 text-cm-body-strong">
              <strong className={cn("font-bold", headlineCls)}>{advice.headline}</strong> {advice.body}
            </p>
          </div>
        </div>
        <div
          className={cn(
            "flex min-w-0 gap-4 border-cm-hairline p-5",
            narrow ? "col-span-2 flex-row items-center justify-between border-t" : "flex-col justify-between border-l"
          )}
        >
          {priceCell}
          {!bought && view.verdict && (
            <div className={cn(!narrow && "mt-4")}>
              <VerdictChip verdict={view.verdict} />
            </div>
          )}
        </div>
      </div>

      {/* ALERT + RANGE */}
      <div className={cn("grid border border-cm-hairline", narrow ? "grid-cols-1 divide-y divide-cm-hairline" : "grid-cols-2 divide-x divide-cm-hairline")}>
        <div className="flex min-w-0 flex-col gap-4 p-6">
          <div className="flex items-center justify-between gap-3">
            <Eyebrow>Alerta de preço</Eyebrow>
            {!bought && a.targetCents != null && (
              <span
                className={cn(
                  "text-[12px] font-bold uppercase tracking-[1.5px]",
                  snoozed ? "text-cm-warn" : a.on ? "text-cm-accent" : "text-cm-muted"
                )}
              >
                {snoozed ? "Silenciado" : a.on ? "Ligado" : "Desligado"}
              </span>
            )}
          </div>
          {bought ? (
            <p className="text-[14px] font-light text-cm-body">Item comprado. Não enviamos mais avisos de preço para ele.</p>
          ) : a.targetCents == null ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-[14px] font-light text-cm-body">Defina um preço e a gente avisa quando a loja chegar nele.</p>
              <CmButton className="h-12 w-full" onClick={() => setAlertOpen(true)}>
                <Bell className="h-4 w-4" /> Definir preço desejado
              </CmButton>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <p className="text-[18px] font-bold leading-6 text-cm-ink">Avisar quando custar {formatBRL(a.targetCents)} ou menos</p>
                <p className="text-[13px] font-light leading-5 text-cm-body">
                  {view.alert?.notifyNewLow ? "Também aviso em novo menor preço. " : ""}
                  {lastAlertText(view.alert)}
                  {snoozed && view.alert?.snoozeUntil ? ` Silenciado até ${formatDay(view.alert.snoozeUntil)}.` : ""}
                </p>
                {reached && <p className="text-[12px] font-bold uppercase tracking-[1.5px] text-cm-accent">Já está nesse preço agora</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <CmButton size="sm" onClick={() => setAlertOpen(true)}>
                  Mudar valor
                </CmButton>
                {snoozed ? (
                  <CmButton size="sm" variant="ghost" disabled={snoozing} onClick={() => snooze(null)}>
                    Reativar
                  </CmButton>
                ) : (
                  a.on && (
                    <CmButton size="sm" variant="ghost" disabled={snoozing} onClick={() => snooze(snoozeUntilIso(7))}>
                      Silenciar 7 dias
                    </CmButton>
                  )
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4 p-6">
          <Eyebrow>Faixa de preço · 90 dias</Eyebrow>
          {bought ? (
            <p className="text-[14px] font-light text-cm-body">Item comprado. Não acompanhamos mais a faixa de preço.</p>
          ) : view.range && view.verdict && view.verdict !== "collecting" ? (
            <RangeBar range={view.range} />
          ) : (
            <p className="text-[14px] font-light text-cm-body">Ainda aprendendo o preço normal deste item.</p>
          )}
        </div>
      </div>

      <Section title="Lojas">
        <OffersTable offers={view.offers} bestId={best?.id ?? null} narrow={narrow} onAdd={() => setOfferOpen(true)} onChanged={changed} />
      </Section>

      <Section title="Histórico">
        <PriceChart itemId={id} offers={view.offers} targetCents={a.on ? a.targetCents : null} refreshKey={chartKey} />
        <div className="flex flex-col gap-4">
          <button
            type="button"
            onClick={() => setStatsOpen((o) => !o)}
            aria-expanded={statsOpen}
            className="inline-flex w-fit items-center gap-1.5 text-[12px] font-bold uppercase tracking-[1.5px] text-cm-muted hover:text-cm-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cm-ink"
          >
            {statsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} Ver estatísticas
          </button>
          {statsOpen && <StatsPanel view={view} />}
        </div>
      </Section>

      {/* Fields save on their own: 600 ms after typing stops, at once on blur or choice. */}
      <div onBlur={() => void auto.flush(true)}>
        <Section title="Sobre o item">
          <ItemForm draft={item} categories={categories} onChange={auto.patch} />
          <div className="flex flex-col gap-5">
            <CmField label="Modelo de especificações" htmlFor="item-template" className="max-w-sm">
              <CmSelect
                id="item-template"
                value={item.templateId ?? ""}
                onChange={(e) => auto.patch({ templateId: e.target.value === "" ? null : e.target.value }, true)}
              >
                <option value="">Sem modelo</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </CmSelect>
            </CmField>
            <SpecsForm
              key={item.templateId ?? ""}
              template={template}
              specs={item.specs}
              onChange={(specs) => auto.patch({ specs })}
              onCommitNow={(specs) => auto.patch({ specs }, true)}
            />
          </div>
        </Section>
      </div>

      <ImageDialog open={imageOpen} itemId={id} onClose={() => setImageOpen(false)} onDone={changed} />
      <AddOfferDialog open={offerOpen} itemId={id} itemName={view.item.name} onClose={() => setOfferOpen(false)} onDone={changed} />
      <MarkBoughtDialog view={boughtOpen ? view : null} onClose={() => setBoughtOpen(false)} onDone={changed} />
      <AlertDialog view={alertOpen ? view : null} onClose={() => setAlertOpen(false)} onDone={changed} />
      <ConfirmDialog
        open={deleteOpen}
        title="Excluir item?"
        description={`"${view.item.name}" será apagado junto com lojas, histórico de preços, compra e imagem. Isso não pode ser desfeito.`}
        confirmLabel="Excluir item"
        busy={deleting}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={remove}
      />
    </div>
  );
}
