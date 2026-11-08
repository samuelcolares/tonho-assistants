import { memo } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ItemView } from "@/types";
import { budgetLine, deltaVsBudget, unitPriceOf } from "./calc";
import { ItemBadges } from "./ItemBadges";
import { formatBRL, formatBRLSigned, formatPct } from "./money";
import { ItemThumb } from "./shared";

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
  const parts = ["32px", "minmax(280px,2.4fr)", "minmax(150px,1fr)", "104px", "104px", "128px", "128px"];
  if (cols.median) parts.push("104px");
  if (cols.p25) parts.push("104px");
  if (cols.pix) parts.push("150px");
  return parts.join(" ");
}

interface ItemsTableProps {
  groups: ItemGroup[];
  cols: ColumnPrefs;
  collapsed: Set<string>;
  onToggleGroup: (category: string) => void;
  onOpen: (id: string) => void;
  onToggleBought: (view: ItemView, bought: boolean) => void;
}

export function ItemsTable({ groups, cols, collapsed, onToggleGroup, onOpen, onToggleBought }: ItemsTableProps) {
  const template = gridTemplate(cols);
  const minWidth = 32 + 280 + 150 + 104 * 2 + 128 * 2 + (cols.median ? 104 : 0) + (cols.p25 ? 104 : 0) + (cols.pix ? 150 : 0) + 80;

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-bg-100">
      <div style={{ minWidth }}>
        <div
          className="sticky top-0 z-10 grid items-center gap-3 border-b border-border bg-bg-100 px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint"
          style={{ gridTemplateColumns: template }}
        >
          <span />
          <span>Item</span>
          <span>Melhor final (un.)</span>
          <span className="text-right">Mín. histórico</span>
          <span className="text-right">Alvo</span>
          <span className="text-right">Orçado</span>
          <span className="text-right">Δ vs orçado</span>
          {cols.median && <span className="text-right">Mediana</span>}
          {cols.p25 && <span className="text-right">Preço bom (P25)</span>}
          {cols.pix && <span className="text-right">Pix vs cartão</span>}
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
      className="flex w-full items-center gap-2 border-b border-border bg-bg-200 px-3 py-2 text-left hover:bg-bg-300"
    >
      <Chevron className="h-4 w-4 text-ink-muted" />
      <strong className="text-[13px] font-semibold text-ink">{group.category || "Sem categoria"}</strong>
      <span className="text-[12px] text-ink-faint">
        {group.items.length} {group.items.length === 1 ? "item" : "itens"} · {bought} comprados
      </span>
      <span className="ml-auto flex items-center gap-4 text-[12px] tabular-nums text-ink-muted">
        <span>
          Orçado <strong className="text-ink">{formatBRL(budget)}</strong>
        </span>
        <span>
          Atual <strong className="text-ink">{formatBRL(current)}</strong>
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
}

const ItemRow = memo(function ItemRow({ view, cols, template, onOpen, onToggleBought }: ItemRowProps) {
  const { item, stats, best } = view;
  const delta = deltaVsBudget(view);
  const line = budgetLine(view);
  const specChips = Object.entries(item.specs)
    .filter(([, val]) => val.trim() !== "")
    .slice(0, 4);

  return (
    <div
      className={cn(
        "grid cursor-pointer items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0 hover:bg-bg-200",
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
        <ItemThumb view={view} size={40} />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-1.5">
            {item.priority > 0 && <Star className="h-3.5 w-3.5 shrink-0 fill-warning text-warning" aria-label="Prioridade alta" />}
            <span className="truncate text-[13px] font-semibold text-ink" title={item.name}>
              {item.name}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {specChips.map(([k, val]) => (
              <span
                key={k}
                className="rounded-sm border border-border px-1.5 text-[10.5px] leading-4 text-ink-muted"
                title={k}
              >
                {val}
              </span>
            ))}
            <ItemBadges view={view} />
          </div>
        </div>
      </div>

      <PriceCell view={view} />

      <span className="text-right text-[13px] tabular-nums text-ink-muted">{formatBRL(stats.allTimeLowCents)}</span>
      <span className="text-right text-[13px] tabular-nums text-ink-muted">{formatBRL(item.targetCents)}</span>
      <div className="flex flex-col items-end">
        <span className="text-[13px] font-medium tabular-nums text-ink">{formatBRL(line)}</span>
        {item.qty !== 1 && item.budgetUnitCents != null && (
          <span className="text-[11px] tabular-nums text-ink-faint">
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
                delta.cents < 0 ? "text-success" : delta.cents > 0 ? "text-danger" : "text-ink-muted"
              )}
            >
              {formatBRLSigned(delta.cents)}
            </span>
            <span className="text-[11px] tabular-nums text-ink-faint">
              {delta.pct > 0 ? "+" : delta.pct < 0 ? "−" : ""}
              {formatPct(Math.abs(delta.pct))}
            </span>
          </>
        ) : (
          <span className="text-[13px] text-ink-faint">—</span>
        )}
      </div>
      {cols.median && <span className="text-right text-[13px] tabular-nums text-ink-muted">{formatBRL(stats.medianCents)}</span>}
      {cols.p25 && <span className="text-right text-[13px] tabular-nums text-ink-muted">{formatBRL(stats.p25Cents)}</span>}
      {cols.pix && (
        <div className="flex flex-col items-end text-[11.5px] tabular-nums">
          {best?.latest ? (
            <>
              <span className="text-success">Pix {formatBRL(best.effectiveCashCents)}</span>
              <span className="text-ink-faint">Cartão {formatBRL(best.latest.listCents)}</span>
            </>
          ) : (
            <span className="text-ink-faint">—</span>
          )}
        </div>
      )}
    </div>
  );
});

function PriceCell({ view }: { view: ItemView }) {
  const { item, best, purchase } = view;
  if (item.bought && purchase) {
    return (
      <div className="flex min-w-0 flex-col">
        <span className="text-[15px] font-bold tabular-nums text-ink">{formatBRL(purchase.paidUnitCents)}</span>
        <span className="truncate text-[11px] text-ink-faint">pago{purchase.store ? ` · ${purchase.store}` : ""}</span>
      </div>
    );
  }
  if (!best || best.finalCents == null) {
    return <span className="text-[12.5px] text-ink-faint">sem preço</span>;
  }
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[15px] font-bold tabular-nums text-compras">{formatBRL(best.finalCents)}</span>
        {!best.shippingKnown && (
          <span
            className="inline-flex items-center gap-0.5 text-[10.5px] font-semibold text-warning"
            title="Frete desconhecido: o preço final pode ser maior"
          >
            <AlertTriangle className="h-3 w-3" /> + frete ?
          </span>
        )}
      </div>
      <span className="truncate text-[11px] text-ink-faint">
        {best.store}
        {best.cashSource ? ` · ${CASH_SOURCE_LABEL[best.cashSource]}` : ""}
      </span>
    </div>
  );
}
