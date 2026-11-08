import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Columns3, Plus, Search, ShoppingCart, Settings as SettingsIcon } from "lucide-react";
import { comprasUnmarkBought } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { ItemView } from "@/types";
import { deltaVsBudget, uniqueCategories } from "./calc";
import { errorMessage, normalizeText } from "./format";
import { ItemsTable, type ColumnPrefs, type ItemGroup } from "./ItemsTable";
import { MarkBoughtDialog } from "./MarkBoughtDialog";
import { loadPref, savePref } from "./storage";
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
  delta: "Δ vs orçado",
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
    return <p className="py-12 text-center text-sm text-ink-muted">{data.error ?? "Carregando itens…"}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar item, spec ou observação…"
            className="pl-9"
          />
        </div>

        <Select value={category} onValueChange={(v) => patch({ category: v })}>
          <SelectTrigger className="w-[170px]">
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

        <div className="inline-flex rounded-md border border-border bg-bg-100 p-0.5">
          {(["pending", "bought", "all"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => patch({ status: s })}
              className={cn(
                "rounded-[7px] px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
                prefs.status === s ? "bg-compras-subtle text-compras" : "text-ink-muted hover:text-ink"
              )}
            >
              {s === "pending" ? "Pendentes" : s === "bought" ? "Comprados" : "Todos"}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <Select value={prefs.sortKey} onValueChange={(v) => patch({ sortKey: v as SortKey })}>
            <SelectTrigger className="w-[160px]" aria-label="Ordenar por">
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
          <Button
            variant="secondary"
            size="icon"
            className="h-9 w-9"
            disabled={prefs.sortKey === "default"}
            aria-label={prefs.sortDir === "asc" ? "Ordem crescente" : "Ordem decrescente"}
            onClick={() => patch({ sortDir: prefs.sortDir === "asc" ? "desc" : "asc" })}
          >
            {prefs.sortDir === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
          </Button>
        </div>

        <div className="relative">
          <Button variant="secondary" onClick={() => setColsOpen((o) => !o)} aria-expanded={colsOpen}>
            <Columns3 className="h-4 w-4" /> Colunas
          </Button>
          {colsOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setColsOpen(false)} />
              <div className="absolute right-0 z-30 mt-1 flex w-52 flex-col gap-1 rounded-md border border-border bg-bg-200 p-2 shadow-md">
                {(
                  [
                    ["median", "Mediana"],
                    ["p25", "Preço bom (P25)"],
                    ["pix", "Pix vs cartão"],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] hover:bg-bg-300">
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
          <Button variant="ghost" onClick={onSettings}>
            <SettingsIcon className="h-4 w-4" /> Configurações
          </Button>
          <Button onClick={() => onAdd(category === "all" ? undefined : category)}>
            <Plus className="h-4 w-4" /> Novo item
          </Button>
        </div>
      </div>

      {all.length === 0 ? (
        <EmptyList onAdd={() => onAdd()} message="Nenhum item ainda. Importe a planilha pelo Painel ou adicione manualmente." />
      ) : shown === 0 ? (
        <EmptyList message="Nenhum item corresponde aos filtros." />
      ) : (
        <>
          <p className="text-[12px] text-ink-faint">
            {shown} de {all.length} itens
          </p>
          <ItemsTable
            groups={groups}
            cols={prefs.cols}
            collapsed={collapsed}
            onToggleGroup={toggleGroup}
            onOpen={onOpen}
            onToggleBought={handleToggleBought}
          />
        </>
      )}

      <MarkBoughtDialog view={boughtTarget} onClose={() => setBoughtTarget(null)} onDone={reload} />
    </div>
  );
}

function EmptyList({ message, onAdd }: { message: string; onAdd?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-14 text-center">
      <ShoppingCart className="h-8 w-8 text-ink-faint" />
      <p className="max-w-sm text-sm text-ink-muted">{message}</p>
      {onAdd && (
        <Button variant="secondary" onClick={onAdd}>
          <Plus className="h-4 w-4" /> Novo item
        </Button>
      )}
    </div>
  );
}
