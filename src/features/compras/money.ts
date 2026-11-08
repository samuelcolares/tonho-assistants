// Pure money helpers. All stored money is integer cents.

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const BRL_COMPACT = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** 129990 -> "R$ 1.299,90". null/undefined/NaN -> "—". */
export function formatBRL(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return BRL.format(cents / 100);
}

/** Compact form for chart axes: "R$ 10 mil". */
export function formatBRLCompact(cents: number): string {
  return BRL_COMPACT.format(cents / 100);
}

/** Signed difference: "+R$ 10,00" / "−R$ 10,00" / "R$ 0,00". */
export function formatBRLSigned(cents: number): string {
  if (cents === 0) return formatBRL(0);
  return `${cents > 0 ? "+" : "−"}${formatBRL(Math.abs(cents))}`;
}

/**
 * Parses user input into cents. Accepts "1.299,90", "1299,90", "1299.90",
 * "R$ 12", "12,5", "1.299". Returns null for empty/invalid/negative input.
 */
export function parseBRLInput(input: string): number | null {
  let s = input.replace(/R\$/gi, "").replace(/\s/g, "");
  if (!s) return null;
  if (!/^[\d.,]+$/.test(s)) return null;
  if (s.includes(",") && s.includes(".") && s.lastIndexOf(".") > s.lastIndexOf(",")) {
    s = s.replace(/,/g, ""); // en-US style "1,299.90"
  } else if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(".")) {
    // "1.299" or "1.299.000" are thousands separators; "12.5" / "1299.90" are decimals.
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  }
  if ((s.match(/\./g) ?? []).length > 1) return null;
  const value = Number(s);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** Cents -> editable string without thousands separators: 129990 -> "1299,90". */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "";
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${neg ? "-" : ""}${whole},${frac}`;
}

/** Percent with one decimal and pt-BR separator: 0.1234 -> "12,3%". */
export function formatPct(fraction: number, digits = 1): string {
  if (!Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}
