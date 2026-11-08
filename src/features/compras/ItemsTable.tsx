import { memo } from "react";
import { AlertTriangle, Bell, ChevronDown, ChevronRight, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ItemView } from "@/types";
import { alertStatus } from "./alertCalc";
import { budgetLine, deltaVsBudget, unitPriceOf } from "./calc";
import { ItemBadges } from "./ItemBadges";
import { formatBRL, formatBRLSigned, formatPct } from "./money";
import { ItemThumb } from "./shared";
import { CmIconButton } from "./ui";

export interface ColumnPrefs {
  median: boolean;
  p25: boolean;
  pix: boolean;
}

export interface ItemGroup {
  category: string;
  items: ItemView[];
}

const CASH_SOURCE_LABEL = {
  page: "Pix na página",
  estimated: "Pix estimado",
  list: "preço cheio",
} as const;

function gridTemplate(cols: ColumnPrefs): string {
  const parts = ["32px", "minmax(280px,2.4fr)", "minmax(150px,1fr)", "104px", "124px", "112px", "112px"];
  if (cols.median) parts.push("104px");
  if (cols.p25) parts.push("104px");
  if (cols.pix) parts.push("150px");
  parts.push("40px");
  return parts.join(" ");
}

interface ItemsTableProps {
  groups: ItemGroup[];
  cols: ColumnPrefs;
  collapsed: Set<string>;
  onToggleGroup: (category: string) => void;
  onOpen: (id: string) => void;
  onToggleBought: (view: ItemView, bought: boolean) => void;
  /** Opens the "Avisar quando baixar" dialog for an item. */
  onAlert: (view: ItemView) => void;
}

export function ItemsTable({ groups, cols, collapsed, onToggleGroup, onOpen, onToggleBought, onAlert }: ItemsTableProps) {
  const template = gridTemplate(cols);
  const minWidth = 32 + 280 + 150 + 104 + 124 + 112 * 2 + 40 + (cols.median ? 104 : 0) + (cols.p25 ? 104 : 0) + (cols.pix ? 150 : 0) + 80;

  return (
    <div className="overflow-x-auto border border-cm-hairline bg-cm-canvas">
      <div style={{ minWidth }}>
        <div
          className="sticky top-0 z-10 grid items-center gap-3 border-b border-cm-hairline bg-cm-canvas px-3 py-3 text-[11px] font-bold uppercase tracking-[1.5px] text-cm-muted"
          style={{ gridTemplateColumns: template }}
        >
          <span />
          <span>Item</span>
          <span>Melhor final (un.)</span>
          <span className="text-right">Mín. histórico</span>
          <span className="text-right">Avisar em</span>
          <span className="text-right">Orçado</span>
          <span className="text-right">Δ vs orçado</span>
          {cols.median && <span className="text-right">Mediana</span>}
          {cols.p25 && <span className="text-right">Preço bom (P25)</span>}
          {cols.pix && <span className="text-right">Pix vs cartão</span>}
          <span className="sr-only">Aviso</span>
        </div>

        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.category);
          return (
            <section key={g.category}>
              <GroupHeader group={g} collapsed={isCollapsed} onToggle={() => onToggleGroup(g.category)} />
              {!isCollapsed &&
                g.items.map((v) => (
                  <ItemRow
                    key={v.item.id}
                    view={v}
                    cols={cols}
                    template={template}
                    onOpen={onOpen}
                    onToggleBought={onToggleBought}
                    onAlert={onAlert}
                  />
                ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function GroupHeader({ group, collapsed, onToggle }: { group: ItemGroup; collapsed: boolean; onToggle: () => void }) {
  const budget = group.items.reduce((acc, v) => acc + (budgetLine(v) ?? 0), 0);
  const current = group.items.reduce((acc, v) => {
    const unit = unitPriceOf(v) ?? v.item.budgetUnitCents ?? 0;
    return acc + unit * v.item.qty;
  }, 0);
  const bought = group.items.filter((v) => v.item.bought).length;
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="flex w-full items-center gap-2 border-b border-cm-hairline bg-cm-soft px-3 py-3 text-left hover:bg-cm-elevated"
    >
      <Chevron className="h-4 w-4 text-cm-muted" />
      <strong className="text-[12px] font-bold uppercase tracking-[1.5px] text-cm-ink">{group.category || "Sem categoria"}</strong>
      <span className="text-[12px] text-cm-muted">
        {group.items.length} {group.items.length === 1 ? "item" : "itens"} · {bought} comprados
      </span>
      <span className="ml-auto flex items-center gap-4 text-[12px] tabular-nums text-cm-body">
        <span>
          Orçado <strong className="text-cm-ink">{formatBRL(budget)}</strong>
        </span>
        <span>
          Atual <strong className="text-cm-ink">{formatBRL(current)}</strong>
        </span>
      </span>
    </button>
  );
}

interface ItemRowProps {
  view: ItemView;
  cols: ColumnPrefs;
  template: string;
  onOpen: (id: string) => void;
  onToggleBought: (view: ItemView, bought: boolean) => void;
  onAlert: (view: ItemView) => void;
}

const ItemRow = memo(function ItemRow({ view, cols, template, onOpen, onToggleBought, onAlert }: ItemRowProps) {
  const { item, stats, best } = view;
  const delta = deltaVsBudget(view);
  const line = budgetLine(view);
  const alert = alertStatus(view);
  const specChips = Object.entries(item.specs)
    .filter(([, val]) => val.trim() !== "")
    .slice(0, 4);

  return (
    <div
      className={cn(
        "grid min-h-16 cursor-pointer items-center gap-3 border-b border-cm-hairline px-3 py-2.5 last:border-b-0 hover:bg-cm-soft",
        item.bought && "opacity-55"
      )}
      style={{ gridTemplateColumns: template }}
      onClick={() => onOpen(item.id)}
    >
      <input
        type="checkbox"
        checked={item.bought}
        aria-label={item.bought ? "Desmarcar compra" : "Marcar como comprado"}
        className="h-4 w-4 cursor-pointer accent-[#2dc98a]"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onToggleBought(view, e.target.checked)}
      />

      <div className="flex min-w-0 items-center gap-3">
        <ItemThumb view={view} size={48} className="rounded-none border-cm-hairline bg-cm-card" />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-1.5">
            {item.priority > 0 && <Star className="h-3.5 w-3.5 shrink-0 fill-cm-warn text-cm-warn" aria-label="Prioridade alta" />}
            <span className="truncate text-[13px] font-bold text-cm-ink" title={item.name}>
              {item.name}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {specChips.map(([k, val]) => (
              <span
                key={k}
                className="rounded-none border border-cm-hairline px-1.5 text-[10.5px] font-light leading-4 text-cm-body"
                title={k}
              >
                {val}
              </span>
            ))}
            <ItemBadges view={view} />
          </div>
        </div>
      </div>

      <PriceCell view={view} reached={alert.reached} />

      <span className="text-right text-[13px] tabular-nums text-cm-body">{formatBRL(stats.allTimeLowCents)}</span>
      <AlertCell view={view} onAlert={onAlert} />
      <div className="flex flex-col items-end">
        <span className="text-[13px] font-bold tabular-nums text-cm-ink">{formatBRL(line)}</span>
        {item.qty !== 1 && item.budgetUnitCents != null && (
          <span className="text-[11px] tabular-nums text-cm-muted">
            {item.qty} × {formatBRL(item.budgetUnitCents)}
          </span>
        )}
      </div>
      <div className="flex flex-col items-end">
        {delta ? (
          <>
            <span
              className={cn(
                "text-[13px] font-semibold tabular-nums",
                delta.cents < 0 ? "text-cm-accent" : delta.cents > 0 ? "text-cm-danger" : "text-cm-body"
              )}
            >
              {formatBRLSigned(delta.cents)}
            </span>
            <span className="text-[11px] tabular-nums text-cm-muted">
              {delta.pct > 0 ? "+" : delta.pct < 0 ? "−" : ""}
              {formatPct(Math.abs(delta.pct))}
            </span>
          </>
        ) : (
          <span className="text-[13px] text-cm-muted">—</span>
        )}
      </div>
      {cols.median && <span className="text-right text-[13px] tabular-nums text-cm-body">{formatBRL(stats.medianCents)}</span>}
      {cols.p25 && <span className="text-right text-[13px] tabular-nums text-cm-body">{formatBRL(stats.p25Cents)}</span>}
      {cols.pix && (
        <div className="flex flex-col items-end text-[11.5px] tabular-nums">
          {best?.latest ? (
            <>
              <span className="text-cm-accent">Pix {formatBRL(best.effectiveCashCents)}</span>
              <span className="text-cm-muted">Cartão {formatBRL(best.latest.listCents)}</span>
            </>
          ) : (
            <span className="text-cm-muted">—</span>
          )}
        </div>
      )}
      <div className="flex justify-end">
        <CmIconButton
          size="sm"
          active={alert.on && !item.bought}
          disabled={item.bought}
          aria-label={alert.on ? `Editar aviso de ${item.name}` : `Avisar quando ${item.name} baixar`}
          title={item.bought ? "Item já comprado" : alert.on ? "Aviso ligado" : "Avisar quando baixar"}
          onClick={(e) => {
            e.stopPropagation();
            onAlert(view);
          }}
        >
          <Bell className="h-4 w-4" />
        </CmIconButton>
      </div>
    </div>
  );
});

/** "Avisar em" column: target value (click edits it) with its status underneath. */
function AlertCell({ view, onAlert }: { view: ItemView; onAlert: (view: ItemView) => void }) {
  const a = alertStatus(view);
  const bought = view.item.bought;
  const hasTarget = a.targetCents != null;
  return (
    <button
      type="button"
      disabled={bought}
      onClick={(e) => {
        e.stopPropagation();
        onAlert(view);
      }}
      className="flex flex-col items-end gap-0.5 rounded-none py-1 text-right focus-visible:outline focus-visible:outline-2 focus-visible:outline-cm-ink enabled:hover:underline disabled:cursor-default"
      aria-label={hasTarget ? "Editar preço do aviso" : "Definir preço do aviso"}
    >
      {!hasTarget ? (
        <span className="text-[12px] font-bold uppercase tracking-[1px] text-cm-muted">{bought ? "—" : "Definir"}</span>
      ) : (
        <span className={cn("text-[13px] font-bold tabular-nums", a.on && !bought ? "text-cm-ink" : "text-cm-muted")}>
          {formatBRL(a.targetCents)}
        </span>
      )}
      {hasTarget && !bought && a.on && a.reached && (
        <span className="text-[11px] font-bold uppercase tracking-[1px] text-cm-accent">atingido</span>
      )}
      {hasTarget && !bought && a.on && !a.reached && a.missingFraction != null && (
        <span className="text-[11px] font-light tabular-nums text-cm-muted">
          faltam {Math.max(1, Math.round(a.missingFraction * 100))}%
        </span>
      )}
      {hasTarget && !bought && !a.on && <span className="text-[11px] font-light text-cm-muted">desligado</span>}
    </button>
  );
}

function PriceCell({ view, reached }: { view: ItemView; reached: boolean }) {
  const { item, best, purchase } = view;
  if (item.bought && purchase) {
    return (
      <div className="flex min-w-0 flex-col">
        <span className="text-[15px] font-bold tabular-nums text-cm-ink">{formatBRL(purchase.paidUnitCents)}</span>
        <span className="truncate text-[11px] text-cm-muted">pago{purchase.store ? ` · ${purchase.store}` : ""}</span>
      </div>
    );
  }
  if (!best || best.finalCents == null) {
    return <span className="text-[12.5px] text-cm-muted">sem preço</span>;
  }
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-baseline gap-1.5">
        <span className={cn("text-[15px] font-bold tabular-nums", reached ? "text-cm-accent" : "text-cm-ink")}>{formatBRL(best.finalCents)}</span>
        {!best.shippingKnown && (
          <span
            className="inline-flex items-center gap-0.5 text-[10.5px] font-bold text-cm-warn"
            title="Frete desconhecido: o preço final pode ser maior"
          >
            <AlertTriangle className="h-3 w-3" /> + frete ?
          </span>
        )}
      </div>
      <span className="truncate text-[11px] text-cm-muted">
        {best.store}
        {best.cashSource ? ` · ${CASH_SOURCE_LABEL[best.cashSource]}` : ""}
      </span>
    </div>
  );
}
