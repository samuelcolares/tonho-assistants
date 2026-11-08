import { useMemo, useState, type ReactNode } from "react";
import { ArrowRight, FileSpreadsheet, Loader2, Plus, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ItemView } from "@/types";
import { alertStatus } from "./alertCalc";
import { BulkAlertDialog } from "./BulkAlertDialog";
import { CategoryChart } from "./CategoryChart";
import { formatRelative } from "./format";
import { ITEMS_PREFS_KEY, type ItemTab } from "./itemFilters";
import { belowAboveText } from "./labels";
import { formatBRL } from "./money";
import { ItemThumb } from "./shared";
import { loadPref, savePref } from "./storage";
import {
  arrivalReason,
  arrivals,
  attentionGroups,
  coverage,
  nextCheckAt,
  parseQuickAdd,
  withoutAlert,
  type AttentionKind,
} from "./todayCalc";
import { CmButton, CmInput, CmStripe } from "./ui";
import type { ComprasData } from "./useComprasData";
import { useContainerWidth } from "./useContainerWidth";
import { ImportReportDialog, useImportXlsx } from "./useImportXlsx";

export interface AddPrefill {
  name?: string;
  url?: string;
}

interface DashboardProps {
  data: ComprasData;
  onOpen: (id: string) => void;
  onAdd: (prefill?: AddPrefill) => void;
  /** Goes to the Itens screen. */
  onGoItems: () => void;
  /** Goes to the Configurações page. */
  onGoSettings: () => void;
}

const hhmm = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Painel "Hoje": what needs a decision now, the budget at a glance, alert coverage and things to check. */
export function Dashboard({ data, onOpen, onAdd, onGoItems, onGoSettings }: DashboardProps) {
  const { items, summary, pollStatus, settings, reload } = data;
  const importer = useImportXlsx(reload);
  const [wrapRef, width] = useContainerWidth<HTMLDivElement>(700);
  const [quick, setQuick] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<AttentionKind | null>(null);

  const all = useMemo(() => items ?? [], [items]);
  const arrived = useMemo(() => arrivals(all), [all]);
  const cover = useMemo(() => coverage(all), [all]);
  const candidates = useMemo(() => withoutAlert(all), [all]);
  const attention = useMemo(() => attentionGroups(all), [all]);
  const next = useMemo(() => (settings?.pollEnabled === false ? null : nextCheckAt(all)), [all, settings?.pollEnabled]);

  const submitQuick = () => {
    onAdd(parseQuickAdd(quick));
    setQuick("");
  };

  const goItemsTab = (tab: ItemTab) => {
    savePref(ITEMS_PREFS_KEY, { ...loadPref<Record<string, unknown>>(ITEMS_PREFS_KEY, {}), tab });
    onGoItems();
  };

  const clickGroup = (kind: AttentionKind, list: ItemView[]) => {
    if (kind === "noPrice") return goItemsTab("noPrice");
    if (list.length === 1) return onOpen(list[0].item.id);
    setOpenGroup(openGroup === kind ? null : kind);
  };

  if (items == null || summary == null) {
    return (
      <div ref={wrapRef}>
        <p className="py-12 text-center text-sm text-cm-muted">{data.error ?? "Carregando painel…"}</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div ref={wrapRef} className="flex flex-col gap-6">
        <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-5 border border-dashed border-cm-hairline px-8 py-16 text-center">
          <FileSpreadsheet className="h-9 w-9 text-cm-accent" />
          <div className="flex flex-col gap-2">
            <h2 className="text-[28px] font-bold uppercase leading-[1.15] text-cm-ink">Comece pela sua planilha</h2>
            <p className="text-[14px] font-light text-cm-body">
              Importe a planilha de compras (aba Produtos) para trazer itens, orçamento e o que já foi comprado. Pode repetir
              sem medo: itens que já existem são atualizados, não duplicados.
            </p>
          </div>
          <CmButton variant="strong" onClick={importer.start} disabled={importer.busy}>
            {importer.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            Importar planilha (.xlsx)
          </CmButton>
          <button
            type="button"
            onClick={() => onAdd()}
            className="text-[13px] font-light text-cm-muted underline-offset-2 hover:text-cm-ink hover:underline"
          >
            ou adicionar o primeiro item manualmente
          </button>
        </div>
        <ImportReportDialog report={importer.report} onClose={importer.clearReport} />
      </div>
    );
  }

  const running = pollStatus?.running ?? false;
  const checkText = running
    ? `Atualizando agora${pollStatus?.queued ? ` · ${pollStatus.queued} na fila` : ""}`
    : pollStatus?.lastRunAt
      ? `Última checagem ${formatRelative(pollStatus.lastRunAt)}${next ? ` · próxima às ${hhmm(next)}` : ""}`
      : "Ainda não checamos os preços";

  const budget = summary.totalBudgetCents;
  const boughtPct = budget > 0 ? Math.min(100, Math.max(0, (summary.boughtCents / budget) * 100)) : 0;
  const delta = summary.remainingAtCurrentCents - summary.remainingBudgetCents;
  const kpi3 = width >= 560;
  const big = width >= 720;

  return (
    <div ref={wrapRef} className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[40px] font-bold uppercase leading-[1.1] tracking-[-0.5px] text-cm-ink">Hoje</h1>
          <p className="mt-2 flex items-center gap-2 text-[14px] font-light text-cm-body">
            <span aria-hidden className={cn("h-2 w-2 rounded-full", running ? "animate-pulse bg-cm-accent" : "bg-cm-muted")} />
            {checkText}
          </p>
        </div>
        <CmButton variant="ghost" onClick={onGoSettings}>
          <SlidersHorizontal className="h-4 w-4" /> Configurações
        </CmButton>
      </header>

      <form
        className="flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submitQuick();
        }}
      >
        <CmInput
          aria-label="Adicionar item"
          className="h-16 min-w-0 flex-1 basis-72 text-[16px]"
          placeholder="Cole o link de um produto ou digite um nome"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
        />
        <CmButton type="submit" variant="strong" className="h-16">
          <Plus className="h-4 w-4" /> Adicionar
        </CmButton>
      </form>

      <section aria-labelledby="hoje-chegaram">
        <CmStripe />
        <div className="flex items-baseline justify-between gap-3 pb-3 pt-4">
          <h2 id="hoje-chegaram" className="text-[20px] font-bold uppercase leading-tight tracking-[1px] text-cm-ink">
            Chegaram no preço · {arrived.length}
          </h2>
        </div>
        {arrived.length === 0 ? (
          <p className="border-t border-cm-hairline py-5 text-[14px] font-light text-cm-muted">
            Nenhum item chegou no preço do aviso ainda. Quando chegar, ele aparece aqui.
          </p>
        ) : (
          <ul className="border-t border-cm-hairline">
            {arrived.map((v) => (
              <li key={v.item.id} className="flex items-center gap-4 border-b border-cm-hairline py-3">
                <ItemThumb view={v} size={56} className="rounded-none border-0 bg-cm-card" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-bold text-cm-ink">{v.item.name}</p>
                  <p className="mt-0.5 text-[13px] font-light text-cm-body">
                    <span className="font-bold tabular-nums text-cm-accent">{formatBRL(v.best?.finalCents)}</span>
                    {v.best ? ` na ${v.best.store}` : ""} · você pediu{" "}
                    <span className="tabular-nums">{formatBRL(alertStatus(v).targetCents)}</span>
                    {arrivalReason(v) ? ` · ${arrivalReason(v)}` : ""}
                  </p>
                </div>
                <CmButton size="sm" onClick={() => onOpen(v.item.id)} aria-label={`Ver ${v.item.name}`}>
                  Ver
                </CmButton>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Resumo do orçamento" className={cn("grid border border-cm-hairline", kpi3 ? "grid-cols-3" : "grid-cols-1")}>
        <Kpi label="Já comprado" big={big} cols3={kpi3} index={0}>
          <p className={cn("font-bold tabular-nums text-cm-ink", big ? "text-[28px]" : "text-[22px]")}>{formatBRL(summary.boughtCents)}</p>
          <div
            className="mt-3 h-1 w-full bg-cm-card"
            role="progressbar"
            aria-valuenow={Math.round(boughtPct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Parte do orçamento já comprada"
          >
            <div className="h-full bg-cm-accent" style={{ width: `${boughtPct}%` }} />
          </div>
          <p className="mt-2 text-[13px] font-light text-cm-body">
            {Math.round(boughtPct)}% do orçamento de {formatBRL(budget)}
          </p>
        </Kpi>
        <Kpi label="Falta (preço de hoje)" big={big} cols3={kpi3} index={1}>
          <p className={cn("font-bold tabular-nums text-cm-ink", big ? "text-[28px]" : "text-[22px]")}>{formatBRL(summary.remainingAtCurrentCents)}</p>
          <p className={cn("mt-3 text-[13px] font-bold", delta < 0 ? "text-cm-accent" : delta > 0 ? "text-cm-warn" : "text-cm-body")}>
            {belowAboveText(delta, formatBRL)} do orçado
          </p>
          <p className="mt-1 text-[13px] font-light text-cm-muted">
            {summary.pricedItems} de {summary.itemsTotal - summary.itemsBought} itens com preço
          </p>
        </Kpi>
        <Kpi label="Alertas ligados" big={big} cols3={kpi3} index={2}>
          <p className={cn("font-bold tabular-nums text-cm-ink", big ? "text-[28px]" : "text-[22px]")}>
            {cover.on} DE {cover.total}
          </p>
          <div className="mt-3">
            {candidates.length > 0 ? (
              <button
                type="button"
                onClick={() => setBulkOpen(true)}
                className="inline-flex items-center gap-1.5 text-left text-[12px] font-bold uppercase tracking-[1.5px] text-cm-accent hover:text-cm-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cm-ink"
              >
                Ligar nos outros (−{settings?.defaultTargetPct ?? 10}%) <ArrowRight className="h-3.5 w-3.5 shrink-0" />
              </button>
            ) : (
              <p className="text-[13px] font-light text-cm-muted">Todo item com preço já tem aviso.</p>
            )}
          </div>
        </Kpi>
      </section>

      <section aria-labelledby="hoje-atencao">
        <h2 id="hoje-atencao" className="border-t border-cm-hairline pt-4 text-[20px] font-bold uppercase leading-tight tracking-[1px] text-cm-ink">
          Precisa de atenção
        </h2>
        {attention.length === 0 ? (
          <p className="py-4 text-[14px] font-light text-cm-muted">Tudo certo por aqui: nada para conferir.</p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap gap-2">
              {attention.map((g) => (
                <button
                  key={g.kind}
                  type="button"
                  title={g.hint}
                  aria-expanded={g.kind === "noPrice" ? undefined : openGroup === g.kind}
                  onClick={() => clickGroup(g.kind, g.items)}
                  className={cn(
                    "inline-flex h-10 items-center gap-2 border px-3 text-[12px] font-bold uppercase tracking-[1px] transition-colors",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cm-ink",
                    openGroup === g.kind ? "border-cm-warn bg-cm-warn text-cm-canvas" : "border-cm-warn text-cm-warn hover:bg-cm-warn hover:text-cm-canvas"
                  )}
                >
                  {g.label(g.items.length)}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>
            {openGroup && (
              <ul className="mt-3 border-t border-cm-hairline">
                {(attention.find((g) => g.kind === openGroup)?.items ?? []).map((v) => (
                  <li key={v.item.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(v.item.id)}
                      className="flex w-full items-center gap-3 border-b border-cm-hairline py-2.5 text-left hover:bg-cm-soft"
                    >
                      <ItemThumb view={v} size={40} className="rounded-none border-0 bg-cm-card" />
                      <span className="min-w-0 flex-1 truncate text-[14px] text-cm-body-strong">{v.item.name}</span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-cm-muted" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="hoje-categorias">
        <h2 id="hoje-categorias" className="border-t border-cm-hairline pt-4 text-[20px] font-bold uppercase leading-tight tracking-[1px] text-cm-ink">
          Por categoria
        </h2>
        <p className="mb-2 mt-1 text-[13px] font-light text-cm-muted">Orçado, já comprado e quanto custa hoje, em cada categoria.</p>
        <CategoryChart data={summary.byCategory} />
      </section>

      <BulkAlertDialog open={bulkOpen} candidates={candidates} onClose={() => setBulkOpen(false)} onDone={reload} />
      <ImportReportDialog report={importer.report} onClose={importer.clearReport} />
    </div>
  );
}

function Kpi({ label, big, cols3, index, children }: { label: string; big: boolean; cols3: boolean; index: number; children: ReactNode }) {
  // hairlines between the cells: vertical in the 3-column strip, horizontal when stacked
  const divider = cols3 ? (index < 2 ? "border-r border-cm-hairline" : "") : index > 0 ? "border-t border-cm-hairline" : "";
  return (
    <div className={cn("min-w-0", big ? "p-6" : "p-4", divider)}>
      <p className="mb-2 text-[12px] font-bold uppercase tracking-[1.5px] text-cm-muted">{label}</p>
      {children}
    </div>
  );
}
