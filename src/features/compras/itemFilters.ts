import type { ItemView } from "@/types";
import { alertStatus } from "./alertCalc";

export type ItemTab = "target" | "falling" | "noAlert" | "noPrice" | "all" | "bought";

export const TAB_ORDER: ItemTab[] = ["target", "falling", "noAlert", "noPrice", "all", "bought"];

export const TAB_LABEL: Record<ItemTab, string> = {
  target: "No preço",
  falling: "Baixando",
  noAlert: "Sem alerta",
  noPrice: "Sem preço",
  all: "Todos",
  bought: "Comprados",
};

export const TAB_HINT: Record<ItemTab, string> = {
  target: "Itens cujo melhor preço já está no valor do aviso ou abaixo dele",
  falling: "Itens cujo preço está baixando",
  noAlert: "Itens não comprados sem aviso ligado",
  noPrice: "Itens que ainda não têm nenhum preço",
  all: "Todos os itens, comprados ou não",
  bought: "Itens já comprados",
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
    default:
      return true;
  }
}

export function tabCounts(items: ItemView[]): Record<ItemTab, number> {
  const out = { target: 0, falling: 0, noAlert: 0, noPrice: 0, all: 0, bought: 0 } as Record<ItemTab, number>;
  for (const v of items) for (const t of TAB_ORDER) if (matchesTab(v, t)) out[t] += 1;
  return out;
}
