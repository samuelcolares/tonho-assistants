import type { ItemView } from "@/types";
import { alertStatus } from "./alertCalc";

export type ItemTab = "target" | "falling" | "noAlert" | "noPrice" | "all" | "bought" | "archived";

export const TAB_ORDER: ItemTab[] = ["target", "falling", "noAlert", "noPrice", "all", "bought", "archived"];

export const TAB_LABEL: Record<ItemTab, string> = {
  target: "No preço",
  falling: "Baixando",
  noAlert: "Sem alerta",
  noPrice: "Sem preço",
  all: "Todos",
  bought: "Comprados",
  archived: "Arquivados",
};

export const TAB_HINT: Record<ItemTab, string> = {
  target: "Itens cujo melhor preço já está no valor do aviso ou abaixo dele",
  falling: "Itens cujo preço está baixando",
  noAlert: "Itens não comprados sem aviso ligado",
  noPrice: "Itens que ainda não têm nenhum preço",
  all: "Todos os itens, comprados ou não (sem os arquivados)",
  bought: "Itens já comprados",
  archived: "Itens guardados fora da lista: sem aviso, sem coleta de preço e fora do orçamento",
};

export function hasPrice(v: ItemView): boolean {
  return v.best?.finalCents != null;
}

export function matchesTab(v: ItemView, tab: ItemTab): boolean {
  const bought = v.item.bought;
  switch (tab) {
    case "target": {
      const a = alertStatus(v);
      return !bought && a.on && a.reached;
    }
    case "falling":
      return !bought && v.stats.trend === "down";
    case "noAlert":
      return !bought && v.alert?.enabled !== true;
    case "noPrice":
      return !bought && !hasPrice(v);
    case "bought":
      return bought;
    case "archived":
      return v.item.archived;
    default:
      return !v.item.archived;
  }
}

/** `items` = active items; `archived` = the archived ones (only counted for their own tab). */
export function tabCounts(items: ItemView[], archived: ItemView[] = []): Record<ItemTab, number> {
  const out = { target: 0, falling: 0, noAlert: 0, noPrice: 0, all: 0, bought: 0, archived: archived.length } as Record<ItemTab, number>;
  for (const v of items) for (const t of TAB_ORDER) if (t !== "archived" && matchesTab(v, t)) out[t] += 1;
  return out;
}
