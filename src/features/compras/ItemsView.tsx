import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Bell, Columns3, Plus, Search, ShoppingCart, Settings as SettingsIcon } from "lucide-react";
import { comprasBulkSetTarget, comprasGetSettings, comprasUnmarkBought } from "@/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { ItemView } from "@/types";
import { AlertDialog } from "./AlertDialog";
import { deltaVsBudget, uniqueCategories } from "./calc";
import { errorMessage, normalizeText } from "./format";
import { ItemsTable, type ColumnPrefs, type ItemGroup } from "./ItemsTable";
import { MarkBoughtDialog } from "./MarkBoughtDialog";
import { loadPref, savePref } from "./storage";
import {
  CmButton,
  CmDialog,
  CmDialogContent,
  CmDialogDescription,
  CmDialogFooter,
  CmDialogTitle,
  CmIconButton,
  CmInput,
} from "./ui";
import type { ComprasData } from "./useComprasData";

type StatusFilter = "pending" | "bought" | "all";
type SortKey = "default" | "name" | "price" | "delta" | "priority";

interface Prefs {
  category: string;
  status: StatusFilter;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  cols: ColumnPrefs;
  collapsed: string[];
}

const PREFS_KEY = "compras.items.prefs.v1";
const DEFAULT_PREFS: Prefs = {
  category: "all",
  status: "pending",
  sortKey: "default",
  sortDir: "asc",
  cols: { median: false, p25: false, pix: false },
  collapsed: [],
};

const SORT_LABELS: Record<SortKey, string> = {
  default: "Ordem da planilha",
  name: "Nome",
  price: "Preço atual",
  delta: "Vs orçado",
  priority: "Prioridade",
};

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
  onSettings: () => void;
}

export function ItemsView({ data, onOpen, onAdd, onSettings }: ItemsViewProps) {
  const { toast } = useToast();
  const { items, reload } = data;
  const [prefs, setPrefs] = useState<Prefs>(() => loadPref(PREFS_KEY, DEFAULT_PREFS));
  const [query, setQuery] = useState("");
  const [colsOpen, setColsOpen] = useState(false);
  const [boughtTarget, setBoughtTarget] = useState<ItemView | null>(null);
  const [alertTarget, setAlertTarget] = useState<ItemView | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkPct, setBulkPct] = useState(10);

  useEffect(() => savePref(PREFS_KEY, prefs), [prefs]);
  const patch = (p: Partial<Prefs>) => setPrefs((prev) => ({ ...prev, ...p }));

  const all = items ?? [];
  const categories = useMemo(() => uniqueCategories(all), [all]);
  const category = categories.includes(prefs.category) ? prefs.category : "all";

  const groups = useMemo<ItemGroup[]>(() => {
    const q = normalizeText(query);
    const filtered = all.filter((v) => {
      if (category !== "all" && v.item.category !== category) return false;
      if (prefs.status === "pending" && v.item.bought) return false;
      if (prefs.status === "bought" && !v.item.bought) return false;
      if (q) {
        const hay = normalizeText(
          [v.item.name, v.item.category, v.item.notes, v.item.modelToken ?? "", ...Object.values(v.item.specs)].join(" ")
        );
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const order: string[] = [];
    const map = new Map<string, ItemView[]>();
    for (const v of filtered) {
      if (!map.has(v.item.category)) {
        map.set(v.item.category, []);
        order.push(v.item.category);
      }
      map.get(v.item.category)!.push(v);
    }
    return order.map((c) => ({
      category: c,
      items: map.get(c)!.slice().sort((a, b) => compare(a, b, prefs.sortKey, prefs.sortDir)),
    }));
  }, [all, category, prefs.status, prefs.sortKey, prefs.sortDir, query]);

  const shown = groups.reduce((n, g) => n + g.items.length, 0);

  // Not-bought items that have a price but no enabled alert: candidates for the bulk action.
  const withoutAlert = useMemo(
    () => all.filter((v) => !v.item.bought && v.best?.finalCents != null && v.alert?.enabled !== true),
    [all]
  );

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

  const toggleGroup = (c: string) => {
    const next = new Set(prefs.collapsed);
    if (next.has(c)) next.delete(c);
    else next.add(c);
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

  if (items == null) {
    return <p className="py-12 text-center text-sm text-cm-muted">{data.error ?? "Carregando itens…"}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-cm-muted" />
          <CmInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar item, spec ou observação…"
            className="pl-11"
          />
        </div>

        <Select value={category} onValueChange={(v) => patch({ category: v })}>
          <SelectTrigger className="h-12 w-[190px] rounded-none border-cm-hairline bg-cm-card font-light text-cm-ink">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as categorias</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="inline-flex h-12 items-stretch gap-5 border-b border-cm-hairline px-1">
          {(["pending", "bought", "all"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => patch({ status: s })}
              className={cn(
                "-mb-px border-b-2 px-1 text-[12px] font-bold uppercase tracking-[1.5px] transition-colors",
                prefs.status === s ? "border-cm-accent text-cm-ink" : "border-transparent text-cm-muted hover:text-cm-ink"
              )}
            >
              {s === "pending" ? "Pendentes" : s === "bought" ? "Comprados" : "Todos"}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <Select value={prefs.sortKey} onValueChange={(v) => patch({ sortKey: v as SortKey })}>
            <SelectTrigger className="h-12 w-[170px] rounded-none border-cm-hairline bg-cm-card font-light text-cm-ink" aria-label="Ordenar por">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {SORT_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <CmIconButton
            disabled={prefs.sortKey === "default"}
            aria-label={prefs.sortDir === "asc" ? "Ordem crescente" : "Ordem decrescente"}
            onClick={() => patch({ sortDir: prefs.sortDir === "asc" ? "desc" : "asc" })}
          >
            {prefs.sortDir === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
          </CmIconButton>
        </div>

        <div className="relative">
          <CmButton onClick={() => setColsOpen((o) => !o)} aria-expanded={colsOpen}>
            <Columns3 className="h-4 w-4" /> Colunas
          </CmButton>
          {colsOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setColsOpen(false)} />
              <div className="absolute right-0 z-30 mt-1 flex w-56 flex-col gap-1 rounded-none border border-cm-hairline bg-cm-card p-2">
                {(
                  [
                    ["median", "Preço típico"],
                    ["p25", "Baixo até"],
                    ["pix", "Pix vs cartão"],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} className="flex cursor-pointer items-center gap-2 px-2 py-2 text-[13px] font-light text-cm-body-strong hover:bg-cm-elevated">
                    <input
                      type="checkbox"
                      className="accent-[#2dc98a]"
                      checked={prefs.cols[k]}
                      onChange={(e) => patch({ cols: { ...prefs.cols, [k]: e.target.checked } })}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <CmButton variant="ghost" onClick={onSettings}>
            <SettingsIcon className="h-4 w-4" /> Configurações
          </CmButton>
          <CmButton
            disabled={withoutAlert.length === 0}
            onClick={openBulk}
            title={
              withoutAlert.length === 0
                ? "Todos os itens com preço já têm aviso"
                : `${withoutAlert.length} itens com preço e sem aviso`
            }
          >
            <Bell className="h-4 w-4" /> Avisar todos sem alerta
            {withoutAlert.length > 0 && <span className="font-light tabular-nums">({withoutAlert.length})</span>}
          </CmButton>
          <CmButton variant="strong" onClick={() => onAdd(category === "all" ? undefined : category)}>
            <Plus className="h-4 w-4" /> Novo item
          </CmButton>
        </div>
      </div>

      {all.length === 0 ? (
        <EmptyList onAdd={() => onAdd()} message="Nenhum item ainda. Importe a planilha pelo Painel ou adicione manualmente." />
      ) : shown === 0 ? (
        <EmptyList message="Nenhum item corresponde aos filtros." />
      ) : (
        <>
          <p className="text-[12px] font-light text-cm-muted">
            {shown} de {all.length} itens
          </p>
          <ItemsTable
            groups={groups}
            cols={prefs.cols}
            collapsed={collapsed}
            onToggleGroup={toggleGroup}
            onOpen={onOpen}
            onToggleBought={handleToggleBought}
            onAlert={setAlertTarget}
          />
        </>
      )}

      <MarkBoughtDialog view={boughtTarget} onClose={() => setBoughtTarget(null)} onDone={reload} />
      <AlertDialog view={alertTarget} onClose={() => setAlertTarget(null)} onDone={reload} />

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
          <Plus className="h-4 w-4" /> Novo item
        </CmButton>
      )}
    </div>
  );
}
