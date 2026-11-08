import { memo, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Bell, ChevronDown, ChevronRight, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ItemView } from "@/types";
import { alertStatus } from "./alertCalc";
import { budgetLine, unitPriceOf } from "./calc";
import { CmTag } from "./ItemBadges";
import { formatBRL } from "./money";
import { PRIORITY_LABEL, priorityOf } from "./rooms";
import { ItemThumb } from "./shared";
import { CmIconButton, CmMenu, CmMenuContent, CmMenuItem, CmMenuSeparator, CmMenuTrigger, Sparkline, VerdictChip } from "./ui";

export interface ItemGroup {
  /** Stable key (collapse state): the category itself, or "room:<name>" when grouping by room. */
  key: string;
  /** Header text: category, room, or the "no category/room" label. */
  title: string;
  items: ItemView[];
}

/**
 * Column layout by list width (px of the list, not of the window). The list is 900 px wide at the default
 * 1180 px window (sidebar 232 + 2 x 24 padding) and 668 px at the 900 px minimum window.
 *   wide   >= 880: thumb 56 | name 1fr | qty 28 | price 116 | verdict 116 | avisar 120 | spark 90 | bell 32 | menu 32
 *                  fixed 590 + 8 gaps x 10 + row padding 16 = 686  ->  name 214 px at 900
 *   medium >= 760: same without the sparkline: 500 + 70 + 16 = 586  ->  name >= 174 px
 *   narrow  < 760: verdict chip moves under the price: 56 | 1fr | 28 | 124 | 120 | 32 | 32
 *                  392 + 60 + 16 = 468  ->  name 200 px at 668
 */
type Mode = "wide" | "medium" | "narrow";
export const WIDE_MIN = 880;
export const MEDIUM_MIN = 760;

const TEMPLATE: Record<Mode, string> = {
  wide: "56px minmax(0,1fr) 28px 116px 116px 120px 90px 32px 32px",
  medium: "56px minmax(0,1fr) 28px 116px 116px 120px 32px 32px",
  narrow: "56px minmax(0,1fr) 28px 124px 120px 32px 32px",
};

function modeFor(width: number): Mode {
  return width >= WIDE_MIN ? "wide" : width >= MEDIUM_MIN ? "medium" : "narrow";
}

interface ItemsTableProps {
  groups: ItemGroup[];
  collapsed: Set<string>;
  onToggleGroup: (key: string) => void;
  onOpen: (id: string) => void;
  onToggleBought: (view: ItemView, bought: boolean) => void;
  /** Opens the "Avisar quando baixar" dialog for an item. */
  onAlert: (view: ItemView) => void;
  onDelete: (view: ItemView) => void;
  onArchive: (view: ItemView, archived: boolean) => void;
}

export function ItemsTable({ groups, collapsed, onToggleGroup, onOpen, onToggleBought, onAlert, onDelete, onArchive }: ItemsTableProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("wide");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = (w: number) => setMode(modeFor(w));
    apply(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => apply(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className="w-full min-w-0">
      {groups.map((g) => {
        const isCollapsed = collapsed.has(g.key);
        return (
          <section key={g.key} aria-label={g.title}>
            <GroupHeader group={g} collapsed={isCollapsed} onToggle={() => onToggleGroup(g.key)} />
            {!isCollapsed && (
              <ul>
                {g.items.map((v) => (
                  <ItemRow
                    key={v.item.id}
                    view={v}
                    mode={mode}
                    onOpen={onOpen}
                    onToggleBought={onToggleBought}
                    onAlert={onAlert}
                    onDelete={onDelete}
                    onArchive={onArchive}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function GroupHeader({ group, collapsed, onToggle }: { group: ItemGroup; collapsed: boolean; onToggle: () => void }) {
  const budget = group.items.reduce((acc, v) => acc + (budgetLine(v) ?? 0), 0);
  const current = group.items.reduce((acc, v) => {
    const unit = unitPriceOf(v) ?? v.item.budgetUnitCents ?? 0;
    return acc + unit * v.item.qty;
  }, 0);
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="flex w-full items-center gap-2 border-b border-cm-hairline px-2 pb-3 pt-7 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cm-ink"
    >
      <Chevron className="h-4 w-4 shrink-0 text-cm-muted" aria-hidden />
      <span className="min-w-0 truncate text-[13px] font-bold uppercase tracking-[1.5px] text-cm-ink">
        {group.title}
      </span>
      <span className="text-[13px] font-bold tabular-nums text-cm-muted">· {group.items.length}</span>
      <span className="ml-auto shrink-0 pl-3 text-[12px] font-light tabular-nums text-cm-muted">
        orçado {formatBRL(budget)} · hoje {formatBRL(current)}
      </span>
    </button>
  );
}

interface ItemRowProps {
  view: ItemView;
  mode: Mode;
  onOpen: (id: string) => void;
  onToggleBought: (view: ItemView, bought: boolean) => void;
  onAlert: (view: ItemView) => void;
  onDelete: (view: ItemView) => void;
  onArchive: (view: ItemView, archived: boolean) => void;
}

/** Small tag only for the extremes: AGORA (accent) and UM DIA (muted). "Em breve" is the default and stays untagged. */
function PriorityTag({ priority }: { priority: number }) {
  const p = priorityOf(priority);
  if (p === 1) return null;
  return (
    <CmTag variant={p === 2 ? "success" : "default"} className={cn("mr-1.5 shrink-0", p === 0 && "text-cm-muted")} title={`Prioridade: ${PRIORITY_LABEL[p].toLowerCase()}`}>
      {PRIORITY_LABEL[p]}
    </CmTag>
  );
}

const ItemRow = memo(function ItemRow({ view, mode, onOpen, onToggleBought, onAlert, onDelete, onArchive }: ItemRowProps) {
  const { item, best, purchase } = view;
  const alert = alertStatus(view);
  const bought = item.bought;
  const archived = item.archived;
  const reached = alert.on && alert.reached && !bought && !archived;

  const specs = Object.values(item.specs)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" · ");
  const where = bought
    ? purchase?.store
      ? `comprado na ${purchase.store}`
      : ""
    : best
      ? `melhor na ${best.store}`
      : view.offers.length > 0
        ? "sem preço nas lojas ainda"
        : "nenhuma loja ainda";

  const verdictChip = archived ? (
    <CmTag>Arquivado</CmTag>
  ) : bought ? (
    <CmTag variant="success">Comprado</CmTag>
  ) : (
    <VerdictChip verdict={view.verdict} className="max-w-full whitespace-normal text-center leading-[14px]" />
  );

  return (
    <li
      className={cn(
        "relative grid min-h-20 items-center gap-x-2.5 border-b border-cm-hairline px-2 py-3 hover:bg-cm-soft",
        (bought || archived) && "opacity-60"
      )}
      style={{ gridTemplateColumns: TEMPLATE[mode] }}
    >
      <ItemThumb view={view} size={56} className="rounded-none border-0 bg-cm-card" />

      <div className="min-w-0">
        {/* Stretched button: its ::after covers the row so a click anywhere opens the detail;
            the controls in the other cells sit above it (relative z-10). */}
        <button
          type="button"
          onClick={() => onOpen(item.id)}
          className="block w-full min-w-0 text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-cm-ink"
        >
          <span
            className="block overflow-hidden text-[15px] font-bold leading-5 text-cm-ink [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]"
            title={item.name}
          >
            {item.name}
          </span>
          <span className="mt-1 flex min-w-0 items-center text-[13px] font-light leading-[18px] text-cm-body">
            {!bought && !archived && <PriorityTag priority={item.priority} />}
            {specs && <span className="min-w-0 truncate">{specs}</span>}
            {specs && where && (
              <span className="shrink-0 px-1" aria-hidden>
                ·
              </span>
            )}
            {where && <span className={cn("whitespace-nowrap", specs ? "shrink-0" : "min-w-0 truncate")}>{where}</span>}
          </span>
        </button>
      </div>

      <span className="text-right text-[13px] font-light tabular-nums text-cm-muted">{item.qty > 1 ? `× ${item.qty}` : ""}</span>

      <PriceBlock view={view} reached={reached}>
        {mode === "narrow" && <div className="mt-1.5 flex justify-end">{verdictChip}</div>}
      </PriceBlock>

      {mode !== "narrow" && <div className="flex justify-center">{verdictChip}</div>}

      {archived ? <span /> : <AlertCell view={view} onAlert={onAlert} />}

      {mode === "wide" && <div className="flex justify-center">{!bought && <Sparkline points={view.sparkline} trend={view.stats.trend} />}</div>}

      <CmIconButton
        size="sm"
        className="relative z-10"
        active={alert.on && !bought && !archived}
        disabled={bought || archived}
        aria-label={alert.on ? `Editar aviso de ${item.name}` : `Avisar quando ${item.name} baixar`}
        title={archived ? "Item arquivado: sem avisos" : bought ? "Item já comprado" : alert.on ? "Aviso ligado" : "Avisar quando baixar"}
        onClick={() => onAlert(view)}
      >
        <Bell className="h-4 w-4" />
      </CmIconButton>

      <CmMenu>
        <CmMenuTrigger asChild>
          <CmIconButton size="sm" className="relative z-10 border-transparent bg-transparent" aria-label={`Mais ações de ${item.name}`}>
            <MoreHorizontal className="h-4 w-4" />
          </CmIconButton>
        </CmMenuTrigger>
        <CmMenuContent>
          <CmMenuItem onSelect={() => onToggleBought(view, !bought)}>{bought ? "Desmarcar comprado" : "Marcar comprado"}</CmMenuItem>
          <CmMenuItem disabled={!best?.url} onSelect={() => best?.url && void openUrl(best.url).catch(() => {})}>
            Abrir na loja
          </CmMenuItem>
          <CmMenuItem onSelect={() => onArchive(view, !archived)}>{archived ? "Desarquivar" : "Arquivar"}</CmMenuItem>
          <CmMenuSeparator />
          <CmMenuItem danger onSelect={() => onDelete(view)}>
            Excluir
          </CmMenuItem>
        </CmMenuContent>
      </CmMenu>
    </li>
  );
});

/** "AVISAR EM" block: label, target value and status; "DEFINIR PREÇO →" when there is no target. */
function AlertCell({ view, onAlert }: { view: ItemView; onAlert: (view: ItemView) => void }) {
  const a = alertStatus(view);
  if (view.item.bought) return <span />;
  const hasTarget = a.targetCents != null;
  return (
    <button
      type="button"
      onClick={() => onAlert(view)}
      aria-label={hasTarget ? `Editar preço do aviso de ${view.item.name}` : `Definir preço do aviso de ${view.item.name}`}
      className="relative z-10 flex min-w-0 flex-col items-start gap-0.5 rounded-none py-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cm-ink"
    >
      <span className="text-[11px] font-bold uppercase tracking-[1.5px] text-cm-muted">Avisar em</span>
      {!hasTarget ? (
        <span className="text-[11px] font-bold uppercase tracking-[1px] text-cm-accent">Definir preço →</span>
      ) : (
        <>
          <span className={cn("text-[14px] font-bold tabular-nums", a.on ? "text-cm-ink" : "text-cm-muted")}>{formatBRL(a.targetCents)}</span>
          {a.on && a.reached && <span className="text-[11px] font-bold uppercase tracking-[1px] text-cm-accent">atingido</span>}
          {a.on && !a.reached && a.missingFraction != null && (
            <span className="text-[12px] font-light tabular-nums text-cm-muted">faltam {Math.max(1, Math.round(a.missingFraction * 100))}%</span>
          )}
          {!a.on && <span className="text-[12px] font-light text-cm-muted">desligado</span>}
        </>
      )}
    </button>
  );
}

function PriceBlock({ view, reached, children }: { view: ItemView; reached: boolean; children?: ReactNode }) {
  const { item, best, purchase } = view;
  if (item.bought && purchase) {
    return (
      <div className="min-w-0 text-right">
        <div className="text-[18px] font-bold tabular-nums text-cm-ink">{formatBRL(purchase.paidUnitCents)}</div>
        <div className="truncate text-[12px] font-light text-cm-muted">pago</div>
        {children}
      </div>
    );
  }
  if (!best || best.finalCents == null) {
    return (
      <div className="min-w-0 text-right">
        <div className="text-[13px] font-light text-cm-muted">sem preço</div>
        {children}
      </div>
    );
  }
  const caption = !best.shippingKnown
    ? { text: "+ frete ?", warn: true, title: "Frete desconhecido: o preço final pode ser maior" }
    : (best.shippingCents ?? 0) === 0
      ? { text: "frete grátis", warn: false, title: undefined }
      : { text: best.cashSource === "list" ? "preço + frete" : "Pix + frete", warn: false, title: undefined };
  return (
    <div className="min-w-0 text-right">
      <div className={cn("text-[18px] font-bold tabular-nums", reached ? "text-cm-accent" : "text-cm-ink")}>{formatBRL(best.finalCents)}</div>
      <div className={cn("truncate text-[12px] leading-4", caption.warn ? "font-bold text-cm-warn" : "font-light text-cm-muted")} title={caption.title}>
        {caption.text}
      </div>
      {children}
    </div>
  );
}
