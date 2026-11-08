import type { CategoryTemplate } from "@/types";
import { normalizeText } from "./format";

/** Suggests the template whose name appears at the start of the item name (accent-insensitive). */
export function suggestTemplate(name: string, templates: CategoryTemplate[]): CategoryTemplate | null {
  const n = normalizeText(name);
  if (!n) return null;
  let best: CategoryTemplate | null = null;
  let bestLen = 0;
  for (const t of templates) {
    const tn = normalizeText(t.name);
    if (!tn) continue;
    const matches = n.startsWith(tn) || n.includes(` ${tn}`) || (tn.split(" ")[0].length >= 4 && n.startsWith(tn.split(" ")[0]));
    if (matches && tn.length > bestLen) {
      best = t;
      bestLen = tn.length;
    }
  }
  return best;
}

/** Keeps only specs whose keys exist on the template, plus free keys the user added. */
export function specKeysOf(template: CategoryTemplate | null): Set<string> {
  return new Set((template?.fields ?? []).map((f) => f.key));
}
