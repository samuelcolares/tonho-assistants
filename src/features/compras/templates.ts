import type { CategoryTemplate } from "@/types";
import { normalizeText } from "./format";

/**
 * Keyword -> template id, matched against the item name as " word word ". A needle ending in a space is a
 * whole word; otherwise it is the start of a word (" rtx" matches "rtx4060"). The occurrence that appears
 * first in the name wins (the noun comes first: "Gabinete Cooler Master" is a gabinete); on a tie the longer
 * needle wins. Mirrors KEYWORDS in src-tauri/src/compras/templates.rs (used when importing the spreadsheet
 * and when an item is created without a template): keep both tables identical.
 */
const KEYWORDS: ReadonlyArray<readonly [string, string]> = [
  // peças de PC
  [" placa de video", "placa-de-video"],
  [" placa video", "placa-de-video"],
  [" rtx", "placa-de-video"],
  [" gtx", "placa-de-video"],
  [" geforce", "placa-de-video"],
  [" radeon", "placa-de-video"],
  [" intel arc ", "placa-de-video"],
  [" gpu ", "placa-de-video"],
  [" rx 5", "placa-de-video"],
  [" rx 6", "placa-de-video"],
  [" rx 7", "placa-de-video"],
  [" rx 9", "placa-de-video"],
  [" rx5", "placa-de-video"],
  [" rx6", "placa-de-video"],
  [" rx7", "placa-de-video"],
  [" rx9", "placa-de-video"],
  [" processador", "processador"],
  [" ryzen", "processador"],
  [" core i3", "processador"],
  [" core i5", "processador"],
  [" core i7", "processador"],
  [" core i9", "processador"],
  [" core ultra", "processador"],
  [" i3 ", "processador"],
  [" i5 ", "processador"],
  [" i7 ", "processador"],
  [" i9 ", "processador"],
  [" xeon", "processador"],
  [" athlon", "processador"],
  [" pentium", "processador"],
  [" celeron", "processador"],
  [" threadripper", "processador"],
  [" cpu ", "processador"],
  [" memoria ram", "memoria-ram"],
  [" memoria ddr", "memoria-ram"],
  [" ddr3", "memoria-ram"],
  [" ddr4", "memoria-ram"],
  [" ddr5", "memoria-ram"],
  [" dimm", "memoria-ram"],
  [" sodimm", "memoria-ram"],
  [" ram ", "memoria-ram"],
  [" ssd", "ssd"],
  [" nvme", "ssd"],
  [" m 2 ", "ssd"],
  [" placa mae", "placa-mae"],
  [" motherboard", "placa-mae"],
  [" mobo ", "placa-mae"],
  [" a520", "placa-mae"],
  [" a620", "placa-mae"],
  [" b450", "placa-mae"],
  [" b550", "placa-mae"],
  [" b650", "placa-mae"],
  [" b850", "placa-mae"],
  [" x570", "placa-mae"],
  [" x670", "placa-mae"],
  [" x870", "placa-mae"],
  [" h410", "placa-mae"],
  [" h510", "placa-mae"],
  [" h610", "placa-mae"],
  [" b560", "placa-mae"],
  [" b660", "placa-mae"],
  [" b760", "placa-mae"],
  [" z490", "placa-mae"],
  [" z590", "placa-mae"],
  [" z690", "placa-mae"],
  [" z790", "placa-mae"],
  [" z890", "placa-mae"],
  [" fonte", "fonte"],
  [" psu ", "fonte"],
  [" 80 plus", "fonte"],
  [" gabinete", "gabinete"],
  [" mid tower", "gabinete"],
  [" full tower", "gabinete"],
  [" monitor", "monitor"],
  [" cooler", "cooler"],
  [" watercooler", "cooler"],
  [" dissipador", "cooler"],
  [" heatsink", "cooler"],
  // casa
  [" ventilador", "ventilador"],
  [" circulador", "ventilador"],
  [" micro ondas", "micro-ondas"],
  [" microondas", "micro-ondas"],
  [" air fryer", "air-fryer"],
  [" airfryer", "air-fryer"],
  [" fritadeira", "air-fryer"],
  [" smart tv", "smart-tv"],
  [" televisao", "smart-tv"],
  [" televisor", "smart-tv"],
  [" tv ", "smart-tv"],
  [" maquina de lavar", "maquina-de-lavar"],
  [" lavadora", "maquina-de-lavar"],
  [" lava e seca", "maquina-de-lavar"],
  [" aspirador vertical", "aspirador-vertical"],
  [" aspirador de po", "aspirador-vertical"],
  [" aspirador ", "aspirador-vertical"],
  // modelos que já existiam
  [" robo aspirador", "robo-aspirador"],
  [" aspirador robo", "robo-aspirador"],
  [" ar condicionado", "ar-condicionado"],
  [" geladeira", "geladeira"],
  [" refrigerador", "geladeira"],
  [" cooktop", "cooktop"],
  [" forno ", "forno"],
  [" lava loucas", "lava-loucas"],
];

/** Category offered next to the existing ones when the suggested template is a PC part. */
export const PC_CATEGORY = "Upgrade PC";
const PC_TEMPLATES = new Set(["placa-de-video", "processador", "memoria-ram", "ssd", "placa-mae", "fonte", "gabinete", "monitor", "cooler"]);

/** "Upgrade PC" for computer parts, null for anything else. */
export function suggestCategoryForTemplate(templateId: string | null | undefined): string | null {
  return templateId && PC_TEMPLATES.has(templateId) ? PC_CATEGORY : null;
}

function keywordTemplateId(name: string): string | null {
  const words = ` ${normalizeText(name)} `;
  if (words.trim() === "") return null;
  let best: { pos: number; len: number; id: string } | null = null;
  for (const [needle, id] of KEYWORDS) {
    const pos = words.indexOf(needle);
    if (pos < 0) continue;
    if (best == null || pos < best.pos || (pos === best.pos && needle.length > best.len)) best = { pos, len: needle.length, id };
  }
  return best?.id ?? null;
}

/**
 * Suggests a template for an item name: by keyword anywhere in the name (RTX, Ryzen, DDR5, NVMe, micro-ondas…),
 * then by the whole template name inside the name (accent-insensitive). No first-word guessing: "Placa de som" is not
 * a "Placa de vídeo".
 */
export function suggestTemplate(name: string, templates: CategoryTemplate[]): CategoryTemplate | null {
  const n = normalizeText(name);
  if (!n) return null;
  const byKeyword = keywordTemplateId(name);
  const keywordHit = byKeyword ? templates.find((t) => t.id === byKeyword) : undefined;
  if (keywordHit) return keywordHit;
  let best: CategoryTemplate | null = null;
  let bestLen = 0;
  for (const t of templates) {
    const tn = normalizeText(t.name);
    if (!tn) continue;
    const matches = n.startsWith(tn) || n.includes(` ${tn}`);
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
