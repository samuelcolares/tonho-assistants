// Pure helpers behind the "Adicionar" dialog (no React, no I/O).

/** Suggested alert price: `pct`% below the current price, in whole cents. null without a usable price. */
export function defaultAlertCents(priceCents: number | null | undefined, pct: number | null | undefined): number | null {
  if (priceCents == null || !Number.isFinite(priceCents) || priceCents <= 0) return null;
  const p = pct != null && Number.isFinite(pct) ? Math.min(90, Math.max(1, pct)) : 10;
  const cents = Math.round(priceCents * (1 - p / 100));
  return cents > 0 ? cents : null;
}

/** The clipboard text when it is exactly one http(s) link, else null. */
export function clipboardLink(text: string | null | undefined): string | null {
  const t = (text ?? "").trim();
  if (!/^https?:\/\/\S+$/i.test(t)) return null;
  try {
    return new URL(t).host ? t : null;
  } catch {
    return null;
  }
}

/** "www.kabum.com.br" -> "kabum.com.br". */
export function hostLabel(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./i, "");
  } catch {
    return url;
  }
}
