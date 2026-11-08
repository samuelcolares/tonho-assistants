import type { AlertRule, HistoryPoint, ItemView } from "@/types";

/** Best current unit price (final, with shipping/Pix) or null when the item has no usable price. */
export function currentPriceOf(v: ItemView): number | null {
  return v.best?.finalCents ?? v.stats.currentFinalCents ?? null;
}

export function emptyRule(itemId: string): AlertRule {
  return {
    itemId,
    enabled: true,
    targetCents: null,
    notifyNewLow: true,
    snoozeUntil: null,
    lastAlertCents: null,
    lastAlertAt: null,
    updatedAt: "",
  };
}

/** Lowest daily best price in a history window. */
export function lowestOf(history: HistoryPoint[]): number | null {
  let min: number | null = null;
  for (const p of history) {
    if (p.bestFinalCents != null && (min == null || p.bestFinalCents < min)) min = p.bestFinalCents;
  }
  return min;
}

/** Days in the history window where the best price was at or below `value`. */
export function daysAtOrBelow(history: HistoryPoint[], value: number): number {
  return history.filter((p) => p.bestFinalCents != null && p.bestFinalCents <= value).length;
}

export interface TargetChip {
  key: string;
  label: string;
  cents: number | null;
}

/** Chips of the "Avisar quando baixar" dialog. `cents: null` = no data, chip is disabled. */
export function targetChips(v: ItemView, low90: number | null): TargetChip[] {
  const current = currentPriceOf(v);
  const pct = (p: number): number | null => (current != null ? Math.round(current * (1 - p / 100)) : null);
  return [
    { key: "p5", label: "−5%", cents: pct(5) },
    { key: "p10", label: "−10%", cents: pct(10) },
    { key: "p15", label: "−15%", cents: pct(15) },
    { key: "low90", label: "Menor em 90 dias", cents: low90 },
    { key: "alltime", label: "Menor já visto", cents: v.stats.allTimeLowCents },
    { key: "budget", label: "Orçado", cents: v.item.budgetUnitCents },
  ];
}

/** Suggested value: lowest of 90 days, else 10% under the current price, else the budget. */
export function prefillTarget(v: ItemView, low90: number | null): number | null {
  const current = currentPriceOf(v);
  return low90 ?? (current != null ? Math.round(current * 0.9) : null) ?? v.item.budgetUnitCents;
}

export interface AlertStatus {
  /** Rule exists and is switched on (bell filled). */
  on: boolean;
  targetCents: number | null;
  reached: boolean;
  /** Fraction the price still has to drop to reach the target (0..1), when not reached. */
  missingFraction: number | null;
}

export function alertStatus(v: ItemView): AlertStatus {
  const on = v.alert?.enabled === true;
  const targetCents = v.alert?.targetCents ?? v.item.targetCents ?? null;
  const current = currentPriceOf(v);
  const reached = targetCents != null && current != null && current <= targetCents;
  const missingFraction =
    targetCents != null && current != null && current > targetCents && current > 0
      ? (current - targetCents) / current
      : null;
  return { on, targetCents, reached, missingFraction };
}
