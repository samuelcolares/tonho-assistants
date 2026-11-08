import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, Bell, Plus, Search, ShoppingCart } from "lucide-react";
import { comprasArchiveItem, comprasBulkSetTarget, comprasDeleteItem, comprasGetSettings, comprasUnmarkBought } from "@/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { ItemView } from "@/types";
import { AlertDialog } from "./AlertDialog";
import { deltaVsBudget } from "./calc";
import { errorMessage, normalizeText } from "./format";
import { hasPrice, matchesTab, TAB_HINT, TAB_LABEL, TAB_ORDER, tabCounts, type ItemTab } from "./itemFilters";
import { ItemsTable, type ItemGroup } from "./ItemsTable";
import { MarkBoughtDialog } from "./MarkBoughtDialog";
import { roomGroupKey } from "./rooms";
import { loadPref, savePref } from "./storage";
import {
  CmButton,
  CmDialog,
  CmDialogContent,
  CmDialogDescription,
  CmDialogFooter,
  CmDialogTitle,
  CmInput,
  CmMenu,
  CmMenuContent,
  CmMenuItem,
  CmMenuSeparator,
  CmMenuTrigger,
} from "./ui";
import type { ComprasData } from "./useComprasData";

type SortKey = "default" | "name" | "price" | "delta" | "priority";
type GroupBy = "room" | "category";

interface Prefs {
  tab: ItemTab;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  groupBy: GroupBy;
  collapsed: string[];
}

const PREFS_KEY = "compras.items.prefs.v2";
const DEFAULT_PREFS: Prefs = { tab: "all", sortKey: "default", sortDir: "asc", groupBy: "category", collapsed: [] };

const SORT_LABELS: Record<SortKey, string> = {
  default: "Planilha",
  name: "Nome",
  price: "Preço",
  delta: "Mais barato vs orçado",
  priority: "Prioridade",
};
const SORT_KEYS = Object.keys(SORT_LABELS) as SortKey[];

const GROUP_MODES: { key: GroupBy; label: string }[] = [
  { key: "room", label: "Cômodo" },
  { key: "category", label: "Categoria" },
];

/** Drops stale/invalid stored values so a bad localStorage entry can never break the screen. */
function sanitize(p: Prefs): Prefs {
  return {
    tab: TAB_ORDER.includes(p.tab) ? p.tab : DEFAULT_PREFS.tab,
    sortKey: SORT_KEYS.includes(p.sortKey) ? p.sortKey : "default",
    sortDir: p.sortDir === "desc" ? "desc" : "asc",
    groupBy: GROUP_MODES.some((m) => m.key === p.groupBy) ? p.groupBy : DEFAULT_PREFS.groupBy,
    collapsed: Array.isArray(p.collapsed) ? p.collapsed.filter((c) => typeof c === "string") : [],
  };
}

function sortValue(v: ItemView, key: SortKey): number | string | null {
  switch (key) {
    case "name":
      return v.item.name.toLocaleLowerCase("pt-BR");
    case "price":
      return v.best?.finalCents ?? v.purchase?.paidUnitCents ?? null;
    case "delta":
      return deltaVsBudget(v)?.cents ?? null;
    case "priority":
      return v.item.priority;
    default:
      return null;
  }
}

function compare(a: ItemView, b: ItemView, key: SortKey, dir: "asc" | "desc"): number {
  if (key === "default") return 0;
  const av = sortValue(a, key);
  const bv = sortValue(b, key);
  if (av == null && bv == null) return 0;
  if (av == null) return 1; // items without a value always go last
  if (bv == null) return -1;
  const r = typeof av === "string" ? av.localeCompare(String(bv), "pt-BR") : (av as number) - (bv as number);
  return dir === "asc" ? r : -r;
}

interface ItemsViewProps {
  data: ComprasData;
  onOpen: (id: string) => void;
  onAdd: (category?: string) => void;
}

export function ItemsView({ data, onOpen, onAdd }: ItemsViewProps) {
  const { toast } = useToast();
  const { items, reload } = data;
  const [prefs, setPrefs] = useState<Prefs>(() => sanitize(loadPref(PREFS_KEY, DEFAULT_PREFS)));
  const [query, setQuery] = useState("");
  const [boughtTarget, setBoughtTarget] = useState<ItemView | null>(null);
  const [alertTarget, setAlertTarget] = useState<ItemView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ItemView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkPct, setBulkPct] = useState(10);

  useEffect(() => savePref(PREFS_KEY, prefs), [prefs]);
  const patch = (p: Partial<Prefs>) => setPrefs((prev) => ({ ...prev, ...p }));

  const all = items ?? [];
  const archivedItems = data.archived;
  const counts = useMemo(() => tabCounts(all, archivedItems), [all, archivedItems]);
  const toBuy = useMemo(() => all.filter((v) => !v.item.bought), [all]);
  const withAlertOn = useMemo(() => toBuy.filter((v) => v.alert?.enabled === true).length, [toBuy]);

  // The ARQUIVADOS tab reads the archived list; every other tab reads the active items.
  const source = prefs.tab === "archived" ? archivedItems : all;

  const groups = useMemo<ItemGroup[]>(() => {
    const q = normalizeText(query);
    const filtered = source.filter((v) => {
      if (!matchesTab(v, prefs.tab)) return false;
      if (q) {
        const hay = normalizeText(
          [v.item.name, v.item.category, v.item.notes, v.item.modelToken ?? "", ...Object.values(v.item.specs)].join(" ")
        );
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const byRoom = prefs.groupBy === "room";
    const order: string[] = [];
    const map = new Map<string, ItemGroup>();
    for (const v of filtered) {
      const room = v.item.room?.trim() ?? "";
      const key = byRoom ? roomGroupKey(room) : v.item.category;
      let g = map.get(key);
      if (!g) {
        g = { key, title: byRoom ? room || "Sem cômodo" : v.item.category || "Sem categoria", items: [] };
        map.set(key, g);
        order.push(key);
      }
      g.items.push(v);
    }
    // Rooms: items without a room form the last group.
    const noRoom = roomGroupKey("");
    const keys = byRoom ? [...order.filter((k) => k !== noRoom), ...order.filter((k) => k === noRoom)] : order;
    return keys.map((k) => {
      const g = map.get(k)!;
      return { ...g, items: g.items.slice().sort((a, b) => compare(a, b, prefs.sortKey, prefs.sortDir)) };
    });
  }, [source, prefs.tab, prefs.groupBy, prefs.sortKey, prefs.sortDir, query]);

  const shown = groups.reduce((n, g) => n + g.items.length, 0);

  // Not-bought items that have a price but no enabled alert: candidates for the bulk action.
  const withoutAlert = useMemo(() => all.filter((v) => !v.item.bought && hasPrice(v) && v.alert?.enabled !== true), [all]);

  const openBulk = () => {
    setBulkOpen(true);
    comprasGetSettings()
      .then((s) => setBulkPct(s.defaultTargetPct > 0 ? s.defaultTargetPct : 10))
      .catch(() => {});
  };

  const confirmBulk = async () => {
    setBulkBusy(true);
    try {
      const n = await comprasBulkSetTarget(
        withoutAlert.map((v) => v.item.id),
        bulkPct
      );
      toast({
        variant: "success",
        title: n === 1 ? "Aviso ligado em 1 item" : `Aviso ligado em ${n} itens`,
        description: `Vamos avisar com ${bulkPct}% abaixo do preço de hoje.`,
      });
      setBulkOpen(false);
      await reload();
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível ligar os avisos", description: errorMessage(e) });
    } finally {
      setBulkBusy(false);
    }
  };
  const collapsed = useMemo(() => new Set(prefs.collapsed), [prefs.collapsed]);

  const toggleGroup = (key: string) => {
    const next = new Set(prefs.collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    patch({ collapsed: Array.from(next) });
  };

  const handleToggleBought = async (v: ItemView, bought: boolean) => {
    if (bought) {
      setBoughtTarget(v);
      return;
    }
    try {
      await comprasUnmarkBought(v.item.id);
      toast({ title: "Compra desfeita", description: v.item.name });
      await reload();
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível desfazer", description: errorMessage(e) });
    }
  };

  const handleArchive = async (v: ItemView, archived: boolean) => {
    try {
      await comprasArchiveItem(v.item.id, archived);
      toast({ title: archived ? "Item arquivado" : "Item desarquivado", description: v.item.name });
      await reload();
    } catch (e) {
      toast({ variant: "danger", title: archived ? "Não foi possível arquivar" : "Não foi possível desarquivar", description: errorMessage(e) });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await comprasDeleteItem(deleteTarget.item.id);
      toast({ title: "Item excluído", description: deleteTarget.item.name });
      setDeleteTarget(null);
      await reload();
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível excluir", description: errorMessage(e) });
    } finally {
      setDeleting(false);
    }
  };

  const chooseSort = (k: SortKey) => patch({ sortKey: k, sortDir: k === "priority" ? "desc" : "asc" });

  if (items == null) {
    return <p className="py-12 text-center text-sm text-cm-muted">{data.error ?? "Carregando itens…"}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="text-[40px] font-bold uppercase leading-[1.1] tracking-[-0.5px] text-cm-ink">Itens</h1>
          <p className="mt-2 text-[14px] font-light text-cm-body">
            {toBuy.length} para comprar · {withAlertOn} com alerta ligado
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {withoutAlert.length > 0 && (
            <CmButton variant="ghost" onClick={openBulk} title={`${withoutAlert.length} itens com preço e sem aviso`}>
              <Bell className="h-4 w-4" /> Avisar todos sem alerta
              <span className="font-light tabular-nums">({withoutAlert.length})</span>
            </CmButton>
          )}
          <div className="flex items-center gap-2" role="group" aria-label="Agrupar por">
            <span className="text-[12px] font-bold uppercase tracking-[1.5px] text-cm-muted">Agrupar:</span>
            {GROUP_MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                aria-pressed={prefs.groupBy === m.key}
                onClick={() => patch({ groupBy: m.key })}
                className={cn(
                  "h-11 border px-4 text-[12px] font-bold uppercase tracking-[1.5px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cm-ink",
                  prefs.groupBy === m.key ? "border-cm-ink text-cm-ink" : "border-cm-hairline text-cm-muted hover:text-cm-ink"
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <CmButton variant="strong" onClick={() => onAdd()}>
            <Plus className="h-4 w-4" /> Adicionar
          </CmButton>
        </div>
      </header>

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-cm-hairline">
        <div className="flex flex-wrap items-end gap-x-5" role="group" aria-label="Filtrar itens">
          {TAB_ORDER.map((t) => {
            const active = prefs.tab === t;
            return (
              <button
                key={t}
                type="button"
                aria-pressed={active}
                title={TAB_HINT[t]}
                onClick={() => patch({ tab: t })}
                className={cn(
                  "-mb-px inline-flex h-12 items-center gap-1.5 border-b-2 text-[12px] font-bold uppercase tracking-[1.5px] transition-colors",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cm-ink",
                  active ? "border-cm-accent text-cm-ink" : "border-transparent text-cm-body hover:text-cm-ink"
                )}
              >
                {TAB_LABEL[t]}
                <span className={cn("tabular-nums", t === "target" && counts.target > 0 ? "text-cm-accent" : "text-cm-muted")}>{counts[t]}</span>
              </button>
            );
          })}
        </div>

        <div className="mb-1.5 ml-auto flex items-center gap-2">
          <div className="relative w-[190px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cm-muted" aria-hidden />
            <CmInput
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar item…"
              aria-label="Buscar item, spec ou observação"
              className="h-10 pl-10 pr-3 text-[13px]"
            />
          </div>
          <CmMenu>
            <CmMenuTrigger asChild>
              <CmButton
                variant="ghost"
                size="sm"
                aria-label={`Ordenar. Atual: ${SORT_LABELS[prefs.sortKey]}`}
                title={`Ordenar: ${SORT_LABELS[prefs.sortKey]}`}
                className="relative h-10 w-10 px-0"
              >
                <ArrowUpDown className="h-4 w-4" aria-hidden />
                {prefs.sortKey !== "default" && <span aria-hidden className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-cm-accent" />}
              </CmButton>
            </CmMenuTrigger>
            <CmMenuContent>
              {SORT_KEYS.map((k) => (
                <CmMenuItem key={k} selected={prefs.sortKey === k} onSelect={() => chooseSort(k)}>
                  {SORT_LABELS[k]}
                </CmMenuItem>
              ))}
              <CmMenuSeparator />
              <CmMenuItem disabled={prefs.sortKey === "default"} onSelect={(e) => { e.preventDefault(); patch({ sortDir: prefs.sortDir === "asc" ? "desc" : "asc" }); }}>
                Ordem: {prefs.sortDir === "asc" ? "crescente" : "decrescente"} (inverter)
              </CmMenuItem>
            </CmMenuContent>
          </CmMenu>
        </div>
      </div>

      {all.length === 0 && archivedItems.length === 0 ? (
        <EmptyList onAdd={() => onAdd()} message="Nenhum item ainda. Importe a planilha pelo Painel ou adicione manualmente." />
      ) : shown === 0 ? (
        <EmptyList
          message={
            query
              ? "Nenhum item corresponde à busca."
              : prefs.tab === "target"
                ? "Nenhum item chegou no preço desejado ainda."
                : prefs.tab === "archived"
                  ? "Nenhum item arquivado. Use “Arquivar” no menu do item para tirá-lo da lista sem apagar."
                  : "Nenhum item nesta aba."
          }
        />
      ) : (
        <ItemsTable
          groups={groups}
          collapsed={collapsed}
          onToggleGroup={toggleGroup}
          onOpen={onOpen}
          onToggleBought={handleToggleBought}
          onAlert={setAlertTarget}
          onDelete={setDeleteTarget}
          onArchive={handleArchive}
        />
      )}

      <MarkBoughtDialog view={boughtTarget} onClose={() => setBoughtTarget(null)} onDone={reload} />
      <AlertDialog view={alertTarget} onClose={() => setAlertTarget(null)} onDone={reload} />

      <CmDialog open={deleteTarget != null} onOpenChange={(o) => !o && !deleting && setDeleteTarget(null)}>
        <CmDialogContent className="max-w-md">
          <CmDialogTitle>Excluir item?</CmDialogTitle>
          <CmDialogDescription>
            “{deleteTarget?.item.name}” será apagado junto com ofertas, histórico de preços, compra e imagem. Isso não pode ser desfeito.
          </CmDialogDescription>
          <CmDialogFooter>
            <CmButton disabled={deleting} onClick={() => setDeleteTarget(null)}>
              Cancelar
            </CmButton>
            <CmButton variant="strong" disabled={deleting} onClick={confirmDelete}>
              {deleting ? "Excluindo…" : "Excluir item"}
            </CmButton>
          </CmDialogFooter>
        </CmDialogContent>
      </CmDialog>

      <CmDialog open={bulkOpen} onOpenChange={(o) => !o && !bulkBusy && setBulkOpen(false)}>
        <CmDialogContent className="max-w-md">
          <CmDialogTitle>Avisar todos sem alerta</CmDialogTitle>
          <CmDialogDescription>
            Ligar aviso com {bulkPct}% abaixo do preço atual em {withoutAlert.length}{" "}
            {withoutAlert.length === 1 ? "item" : "itens"}?
          </CmDialogDescription>
          <p className="text-[13px] font-light text-cm-muted">
            Só entram itens não comprados que já têm preço e ainda não têm aviso ligado. Você pode ajustar cada um depois.
          </p>
          <CmDialogFooter>
            <CmButton disabled={bulkBusy} onClick={() => setBulkOpen(false)}>
              Cancelar
            </CmButton>
            <CmButton variant="strong" disabled={bulkBusy || withoutAlert.length === 0} onClick={confirmBulk}>
              {bulkBusy ? "Ligando…" : "Ligar avisos"}
            </CmButton>
          </CmDialogFooter>
        </CmDialogContent>
      </CmDialog>
    </div>
  );
}

function EmptyList({ message, onAdd }: { message: string; onAdd?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 border border-dashed border-cm-hairline py-14 text-center">
      <ShoppingCart className="h-8 w-8 text-cm-muted" />
      <p className="max-w-sm text-sm font-light text-cm-body">{message}</p>
      {onAdd && (
        <CmButton onClick={onAdd}>
          <Plus className="h-4 w-4" /> Adicionar
        </CmButton>
      )}
    </div>
  );
}
