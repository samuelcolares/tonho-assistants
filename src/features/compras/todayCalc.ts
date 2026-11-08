// Pure helpers behind the "Hoje" panel (no React, no I/O).
import type { ItemView, OfferView } from "@/types";
import { alertStatus } from "./alertCalc";
import { hasPrice } from "./itemFilters";

const pending = (items: ItemView[]) => items.filter((v) => !v.item.bought && !v.item.archived);

/** Items whose best price is at or below the alert price, with the alert switched on. */
export function arrivals(items: ItemView[]): ItemView[] {
  return pending(items).filter((v) => {
    const a = alertStatus(v);
    return a.on && a.reached;
  });
}

/** "Pix + frete", "Pix estimado, frete não informado", "preço de lista + frete"... how the best price was built. */
export function basisText(best: OfferView | null): string {
  if (!best) return "";
  const cash = best.cashSource === "page" ? "Pix" : best.cashSource === "estimated" ? "Pix estimado" : best.cashSource === "list" ? "preço de lista" : "preço";
  return best.shippingKnown ? `${cash} + frete` : `${cash}, frete não informado`;
}

/** Short reason shown under an arrived item. */
export function arrivalReason(v: ItemView): string {
  if (v.stats.isHistoricalLow) return "menor preço já visto";
  if (v.verdict === "low") return "preço baixo nos últimos 90 dias";
  return basisText(v.best);
}

/** Pending items that have a price but no alert on: the bulk action's audience. */
export function withoutAlert(items: ItemView[]): ItemView[] {
  return pending(items).filter((v) => hasPrice(v) && v.alert?.enabled !== true);
}

export interface Coverage {
  on: number;
  total: number;
}

/** Alerts on among the items still to buy. */
export function coverage(items: ItemView[]): Coverage {
  const p = pending(items);
  return { on: p.filter((v) => v.alert?.enabled === true).length, total: p.length };
}

export type AttentionKind = "manual" | "check" | "broken" | "noShipping" | "noPrice";

export interface AttentionGroup {
  kind: AttentionKind;
  label: (n: number) => string;
  hint: string;
  items: ItemView[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Things worth a look, only the non-empty groups. "noPrice" has its own tab on the Itens screen. */
export function attentionGroups(items: ItemView[]): AttentionGroup[] {
  const p = pending(items);
  const withStatus = (status: OfferView["status"]) => p.filter((v) => v.offers.some((o) => o.status === status));
  const groups: AttentionGroup[] = [
    {
      kind: "manual",
      label: (n) => `${plural(n, "item pede", "itens pedem")} preço manual`,
      hint: "A loja não deixa consultar sozinha: digite o preço você mesmo",
      items: withStatus("blocked"),
    },
    {
      kind: "check",
      label: (n) => `${n} para conferir`,
      hint: "O preço mudou demais ou o produto parece outro",
      items: withStatus("suspect"),
    },
    {
      kind: "broken",
      label: (n) => `${plural(n, "link com erro", "links com erro")}`,
      hint: "Não conseguimos ler a página da loja várias vezes seguidas",
      items: withStatus("broken"),
    },
    {
      kind: "noShipping",
      label: (n) => `${n} sem frete informado`,
      hint: "O melhor preço ainda não inclui o frete",
      items: p.filter((v) => v.best != null && v.best.finalCents != null && !v.best.shippingKnown),
    },
    {
      kind: "noPrice",
      label: (n) => `${n} sem preço`,
      hint: "Itens que ainda não têm nenhum preço",
      items: p.filter((v) => !hasPrice(v)),
    },
  ];
  return groups.filter((g) => g.items.length > 0);
}

/** Earliest scheduled check that is still in the future, among offers that are polled automatically. */
export function nextCheckAt(items: ItemView[], now: number = Date.now()): Date | null {
  let best: number | null = null;
  for (const v of pending(items)) {
    for (const o of v.offers) {
      if (!o.url || o.status === "paused" || o.status === "manual" || o.status === "blocked" || !o.nextPollAt) continue;
      const t = Date.parse(o.nextPollAt);
      if (Number.isFinite(t) && t > now && (best == null || t < best)) best = t;
    }
  }
  return best == null ? null : new Date(best);
}

/** Text typed in the quick-add field: a link opens the preview step, anything else is the item name. */
export function parseQuickAdd(raw: string): { url?: string; name?: string } {
  const text = raw.trim();
  if (!text) return {};
  if (/^https?:\/\/\S+$/i.test(text)) return { url: text };
  if (/^www\.\S+\.\S+$/i.test(text) || /^[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*$/i.test(text)) return { url: `https://${text}` };
  return { name: text };
}
