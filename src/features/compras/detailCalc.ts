// Pure copy/number helpers for the item detail screen (hero, alert card, range bar).
import type { AlertRule, ItemView, OfferView } from "@/types";
import { alertStatus } from "./alertCalc";
import { formatRelative } from "./format";
import { VERDICT_ADVICE } from "./labels";
import { formatBRL } from "./money";
import { PRIORITY_LABEL, priorityOf } from "./rooms";

export interface Advice {
  /** Short bold clause ("Bom momento para comprar."). */
  headline: string;
  /** Plain explanation after the headline. */
  body: string;
  tone: "good" | "warn" | "neutral";
}

/** Advice sentence of the hero, built from verdict, historical low and target. */
export function adviceFor(view: ItemView): Advice {
  const { item, verdict, stats } = view;
  if (item.bought) return { headline: "Item comprado.", body: "Não acompanhamos mais o preço dele.", tone: "neutral" };
  if (!verdict) {
    return {
      headline: "Ainda sem preço.",
      body: view.offers.length > 0 ? "Esperando as lojas responderem." : "Cole o link de uma loja para começar a acompanhar.",
      tone: "neutral",
    };
  }
  const a = alertStatus(view);
  const headline = `${VERDICT_ADVICE[verdict]}.`;
  switch (verdict) {
    case "low":
      return {
        headline,
        body: `${stats.isHistoricalLow ? "É o menor preço que já vimos" : "Está entre os preços mais baixos dos últimos 90 dias"}${
          a.on && a.reached ? ", e já está no valor que você pediu." : "."
        }`,
        tone: "good",
      };
    case "normal":
      return {
        headline,
        body: `Está na faixa comum dos últimos 90 dias.${
          a.on && a.missingFraction != null ? ` Faltam ${Math.max(1, Math.round(a.missingFraction * 100))}% para o seu aviso.` : ""
        }`,
        tone: "neutral",
      };
    case "high":
      return {
        headline,
        body: `Está entre os preços mais altos dos últimos 90 dias.${a.on ? "" : " Defina um aviso e a gente te chama quando baixar."}`,
        tone: "warn",
      };
    default:
      return { headline, body: "Ainda estamos aprendendo o preço normal deste item.", tone: "neutral" };
  }
}

const CASH_CAPTION = { page: "Pix", estimated: "Pix estimado", list: "preço cheio" } as const;

export interface CaptionPart {
  text: string;
  warn?: boolean;
}

/** "Pix · frete grátis · há 40 min" for the best offer. */
export function bestCaption(best: OfferView, now: number = Date.now()): CaptionPart[] {
  const out: CaptionPart[] = [];
  if (best.cashSource) out.push({ text: CASH_CAPTION[best.cashSource] });
  if (!best.shippingKnown) out.push({ text: "frete não informado", warn: true });
  else if ((best.shippingCents ?? 0) === 0) out.push({ text: "frete grátis" });
  else out.push({ text: `frete ${formatBRL(best.shippingCents)}` });
  const when = best.lastCheckedAt ?? best.latest?.lastSeenAt;
  if (when) out.push({ text: formatRelative(when, now) });
  return out;
}

/** True while the rule is silenced. */
export function isSnoozed(rule: AlertRule | null | undefined, now: number = Date.now()): boolean {
  if (!rule?.snoozeUntil) return false;
  const t = Date.parse(rule.snoozeUntil);
  return Number.isFinite(t) && t > now;
}

export function snoozeUntilIso(days: number, now: number = Date.now()): string {
  return new Date(now + days * 24 * 3600 * 1000).toISOString();
}

/** "Último aviso: R$ 1.200,00 há 3 dias." / "Último aviso: nenhum ainda." */
export function lastAlertText(rule: AlertRule | null | undefined, now: number = Date.now()): string {
  if (!rule?.lastAlertAt) return "Último aviso: nenhum ainda.";
  const price = rule.lastAlertCents != null ? `${formatBRL(rule.lastAlertCents)} ` : "";
  return `Último aviso: ${price}${formatRelative(rule.lastAlertAt, now)}.`;
}

export const priorityLabel = (p: number) => PRIORITY_LABEL[priorityOf(p)];

/** "Cômodo · Categoria · Prioridade" line shown above the item title (room omitted when empty). */
export function metaLine(item: { room: string | null; category: string; priority: number; archived?: boolean }): string {
  const room = item.room?.trim();
  return [room, item.category || "Sem categoria", priorityLabel(item.priority), item.archived ? "Arquivado" : null].filter(Boolean).join(" · ");
}
