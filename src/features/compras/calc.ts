import type { ItemView, OfferStatus } from "@/types";

export interface Delta {
  /** Signed difference in cents (negative = cheaper than budget). */
  cents: number;
  /** Signed fraction relative to budget (-0.1 = 10% cheaper). */
  pct: number;
}

/** Unit price that currently represents the item: paid price if bought, else best final. */
export function unitPriceOf(v: ItemView): number | null {
  if (v.item.bought && v.purchase) return v.purchase.paidUnitCents;
  return v.best?.finalCents ?? null;
}

/** Quantity multiplier for line totals (qty 0 rows are treated as a single unit). */
export function lineQty(v: ItemView): number {
  return v.item.qty > 0 ? v.item.qty : 1;
}

export function budgetLine(v: ItemView): number | null {
  const unit = v.item.budgetUnitCents;
  if (unit == null) return null;
  return unit * v.item.qty;
}

/** Delta of the current/paid price vs the budgeted unit price, over the whole line. */
export function deltaVsBudget(v: ItemView): Delta | null {
  const unit = v.item.budgetUnitCents;
  const price = unitPriceOf(v);
  if (unit == null || unit <= 0 || price == null) return null;
  return { cents: (price - unit) * lineQty(v), pct: (price - unit) / unit };
}

export const PROBLEM_STATUSES: OfferStatus[] = ["suspect", "blocked", "broken"];

export function hasStatus(v: ItemView, status: OfferStatus): boolean {
  return v.offers.some((o) => o.status === status);
}

export function problemOffers(v: ItemView) {
  return v.offers.filter((o) => PROBLEM_STATUSES.includes(o.status));
}

export function uniqueCategories(items: ItemView[]): string[] {
  return Array.from(new Set(items.map((i) => i.item.category))).sort((a, b) => a.localeCompare(b, "pt-BR"));
}
