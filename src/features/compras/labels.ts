// Plain-language copy for statuses, verdicts and trends (spec P3). One place so every screen agrees.
import type { OfferStatus, Verdict } from "@/types";

export type StatusVariant = "default" | "success" | "warning" | "danger";

export interface StatusInfo {
  label: string;
  /** Plain explanation shown as a tooltip. */
  hint: string;
  variant: StatusVariant;
}

export const STATUS_INFO: Record<OfferStatus, StatusInfo> = {
  ok: { label: "OK", hint: "O preço está sendo atualizado normalmente", variant: "success" },
  pending: { label: "Aguardando", hint: "Ainda não consultamos esta loja; o preço aparece em instantes", variant: "default" },
  manual: { label: "Preço digitado", hint: "Você digitou este preço; ele não muda sozinho", variant: "default" },
  suspect: {
    label: "Conferir",
    hint: "O preço mudou demais ou o produto parece outro; confira se está certo",
    variant: "warning",
  },
  blocked: {
    label: "Só manual",
    hint: "A loja não deixa consultar automaticamente; atualize o preço você mesmo",
    variant: "danger",
  },
  broken: {
    label: "Com erro",
    hint: "Não conseguimos ler a página da loja várias vezes seguidas; confira o link",
    variant: "danger",
  },
  paused: { label: "Pausado", hint: "Esta loja está pausada e não entra na comparação de preços", variant: "default" },
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  low: "Preço baixo",
  normal: "Preço normal",
  high: "Preço alto",
  collecting: "Ainda aprendendo",
};

/** One-line advice under the item title. */
export const VERDICT_ADVICE: Record<Verdict, string> = {
  low: "Bom momento para comprar",
  normal: "Preço dentro do comum",
  high: "Espere, está acima do normal",
  collecting: "Poucos dados ainda",
};

export const VERDICT_HINT: Record<Verdict, string> = {
  low: "O preço de hoje está entre os mais baixos dos últimos 90 dias",
  normal: "O preço de hoje está na faixa comum dos últimos 90 dias",
  high: "O preço de hoje está entre os mais altos dos últimos 90 dias",
  collecting: "Ainda não temos preços suficientes para saber se está barato ou caro",
};

/** "R$ 10,00 abaixo" / "R$ 10,00 acima" / "no valor". Pass the signed difference (negative = cheaper). */
export function belowAboveText(cents: number, formatMoney: (c: number) => string): string {
  if (cents === 0) return "no valor";
  return `${formatMoney(Math.abs(cents))} ${cents < 0 ? "abaixo" : "acima"}`;
}

export const TREND_LABEL = { down: "Baixando", up: "Subindo", flat: "Estável" } as const;
