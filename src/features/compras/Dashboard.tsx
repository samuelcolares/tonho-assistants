import { useMemo, useState, type ReactNode } from "react";
import { FileSpreadsheet, Loader2, Plus, RefreshCw, Settings as SettingsIcon, TrendingDown } from "lucide-react";
import { comprasRefresh } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { ItemView } from "@/types";
import { problemOffers } from "./calc";
import { CategoryChart } from "./CategoryChart";
import { errorMessage, formatRelative } from "./format";
import { formatBRL, formatPct } from "./money";
import { CmTag } from "./ItemBadges";
import { belowAboveText, STATUS_INFO } from "./labels";
import { ItemThumb } from "./shared";
import { ImportReportDialog, useImportXlsx } from "./useImportXlsx";
import type { ComprasData } from "./useComprasData";

interface DashboardProps {
  data: ComprasData;
  onOpen: (id: string) => void;
  onAdd: () => void;
  onSettings: () => void;
}

export function Dashboard({ data, onOpen, onAdd, onSettings }: DashboardProps) {
  const { toast } = useToast();
  const { items, summary, pollStatus, reload } = data;
  const importer = useImportXlsx(reload);
  const [refreshing, setRefreshing] = useState(false);

  const lists = useMemo(() => {
    const pending = (items ?? []).filter((v) => !v.item.bought);
    return {
      belowTarget: pending.filter((v) => v.stats.belowTarget),
      historicalLow: pending.filter((v) => v.stats.isHistoricalLow),
      problems: pending.filter((v) => problemOffers(v).length > 0),
    };
  }, [items]);

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await comprasRefresh(null, null);
      toast({ title: "Atualização iniciada", description: "Os preços vão aparecendo conforme as lojas respondem." });
    } catch (e) {
      toast({ variant: "danger", title: "Falha ao atualizar", description: errorMessage(e) });
    } finally {
      setRefreshing(false);
    }
  };

  if (items == null || summary == null) {
    return <p className="py-12 text-center text-sm text-ink-muted">{data.error ?? "Carregando painel…"}</p>;
  }

  if (items.length === 0) {
    return (
      <>
        <div className="mx-auto flex max-w-xl flex-col items-center gap-5 rounded-lg border border-dashed border-border px-8 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-compras-subtle text-compras">
            <FileSpreadsheet className="h-7 w-7" />
          </div>
          <div className="flex flex-col gap-1.5">
            <h2 className="text-lg font-semibold text-ink">Comece pela sua planilha</h2>
            <p className="text-sm text-ink-muted">
              Importe a planilha de compras (aba Produtos) para trazer itens, orçamento e o que já foi comprado. A
              importação é segura para repetir: itens existentes são atualizados, não duplicados.
            </p>
          </div>
          <Button size="default" className="h-11 bg-compras px-6 text-base text-on-brand hover:bg-compras/85" onClick={importer.start} disabled={importer.busy}>
            {importer.busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileSpreadsheet className="h-5 w-5" />}
            Importar planilha (.xlsx)
          </Button>
          <button type="button" onClick={onAdd} className="text-[13px] text-ink-muted underline-offset-2 hover:text-ink hover:underline">
            ou adicionar o primeiro item manualmente
          </button>
        </div>
        <ImportReportDialog report={importer.report} onClose={importer.clearReport} />
      </>
    );
  }

  const pendingCount = summary.itemsTotal - summary.itemsBought;
  const deltaCurrent = summary.remainingAtCurrentCents - summary.remainingBudgetCents;
  const deltaPct = summary.remainingBudgetCents > 0 ? deltaCurrent / summary.remainingBudgetCents : 0;
  const running = pollStatus?.running ?? false;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" onClick={onSettings}>
          <SettingsIcon className="h-4 w-4" /> Configurações
        </Button>
        <Button variant="secondary" onClick={onAdd}>
          <Plus className="h-4 w-4" /> Novo item
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Orçamento total" value={formatBRL(summary.totalBudgetCents)} sub={`${summary.itemsTotal} itens`} />
        <Kpi
          label="Já comprado"
          value={formatBRL(summary.boughtCents)}
          valueClass="text-success"
          sub={`${summary.itemsBought} de ${summary.itemsTotal} itens`}
        />
        <Kpi label="Falta (orçado)" value={formatBRL(summary.remainingBudgetCents)} sub={`${pendingCount} itens pendentes`} />
        <Kpi label="% concluído" value={formatPct(summary.pctDone)}>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-bg-300" role="progressbar" aria-valuenow={Math.round(summary.pctDone * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-compras transition-all" style={{ width: `${Math.min(100, Math.max(0, summary.pctDone * 100))}%` }} />
          </div>
        </Kpi>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        <Card className="flex flex-col gap-1 lg:col-span-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Falta a preço atual</span>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-3xl font-bold tabular-nums text-ink">{formatBRL(summary.remainingAtCurrentCents)}</span>
            <span className={cn("text-sm font-semibold tabular-nums", deltaCurrent < 0 ? "text-success" : deltaCurrent > 0 ? "text-danger" : "text-ink-muted")}>
              vs orçado: {belowAboveText(deltaCurrent, formatBRL)}
              {deltaCurrent !== 0 && ` (${formatPct(Math.abs(deltaPct))})`}
            </span>
          </div>
          <span className="text-[12.5px] text-ink-muted">
            {summary.pricedItems} de {pendingCount} itens pendentes com preço; os demais entram pelo valor orçado.
          </span>
        </Card>

        <Card className="flex flex-col justify-between gap-3 lg:col-span-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Verificação de preços</span>
              <span className="text-sm font-medium text-ink">
                {running ? `Atualizando… ${pollStatus?.queued ? `(${pollStatus.queued} na fila)` : ""}` : `Última: ${formatRelative(pollStatus?.lastRunAt)}`}
              </span>
            </div>
            <span className={cn("mt-1 h-2 w-2 rounded-full", running ? "animate-pulse bg-compras" : "bg-ink-faint")} />
          </div>
          <Button variant="secondary" onClick={refreshAll} disabled={refreshing || running}>
            <RefreshCw className={cn("h-4 w-4", (refreshing || running) && "animate-spin")} /> Atualizar tudo
          </Button>
        </Card>
      </div>

      <Card className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-ink">Por categoria</h3>
        <CategoryChart data={summary.byCategory} />
      </Card>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <ItemList title="No preço desejado" empty="Nenhum item no preço desejado ainda. Use o sino para ser avisado quando baixar." items={lists.belowTarget} onOpen={onOpen} renderRight={(v) => <TargetRight v={v} />} />
        <ItemList title="No menor preço já visto" empty="Nenhum item no menor preço já visto." items={lists.historicalLow} onOpen={onOpen} renderRight={(v) => <span className="text-[13px] font-semibold tabular-nums text-success">{formatBRL(v.best?.finalCents)}</span>} icon={<TrendingDown className="h-4 w-4 text-success" />} />
        <ItemList title="Ofertas com problema" empty="Todas as ofertas estão saudáveis." items={lists.problems} onOpen={onOpen} renderRight={(v) => <ProblemRight v={v} />} />
      </div>

      <ImportReportDialog report={importer.report} onClose={importer.clearReport} />
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  valueClass,
  children,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
  children?: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-0.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{label}</span>
      <span className={cn("text-2xl font-bold tabular-nums text-ink", valueClass)}>{value}</span>
      {sub && <span className="text-[12px] text-ink-muted">{sub}</span>}
      {children}
    </Card>
  );
}

function ItemList({
  title,
  empty,
  items,
  onOpen,
  renderRight,
  icon,
}: {
  title: string;
  empty: string;
  items: ItemView[];
  onOpen: (id: string) => void;
  renderRight: (v: ItemView) => ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          {icon}
          {title}
        </h3>
        <Badge variant="default">{items.length}</Badge>
      </div>
      {items.length === 0 ? (
        <p className="py-3 text-[12.5px] text-ink-faint">{empty}</p>
      ) : (
        <ul className="flex max-h-72 flex-col overflow-y-auto">
          {items.map((v) => (
            <li key={v.item.id}>
              <button
                type="button"
                onClick={() => onOpen(v.item.id)}
                className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-bg-200"
              >
                <ItemThumb view={v} size={32} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{v.item.name}</span>
                {renderRight(v)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TargetRight({ v }: { v: ItemView }) {
  return (
    <span className="flex flex-col items-end leading-tight">
      <span className="text-[13px] font-semibold tabular-nums text-success">{formatBRL(v.best?.finalCents)}</span>
      <span className="text-[10.5px] tabular-nums text-ink-faint">avisar em {formatBRL(v.item.targetCents)}</span>
    </span>
  );
}

function ProblemRight({ v }: { v: ItemView }) {
  const offers = problemOffers(v);
  return (
    <span className="flex max-w-[48%] flex-col items-end gap-0.5 leading-tight">
      {offers.slice(0, 2).map((o) => {
        const s = STATUS_INFO[o.status];
        return (
          <span key={o.id} className="flex items-center gap-1" title={o.lastError ?? undefined}>
            <span className="truncate text-[11px] text-ink-muted">{o.store}</span>
            <CmTag variant={s.variant} title={s.hint}>
              {s.label}
            </CmTag>
          </span>
        );
      })}
    </span>
  );
}
