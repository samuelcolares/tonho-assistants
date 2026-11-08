// Rooms and priority levels (pure helpers). Priority: 0 "Um dia", 1 "Em breve", 2 "Agora".
import type { ItemView } from "@/types";

/** Suggestions shown when the user has not set up rooms in the settings. */
export const DEFAULT_ROOMS = ["Sala", "Cozinha", "Quarto", "Quarto de hóspedes", "Banheiro", "Área de serviço", "Varanda", "Escritório"];

export type Priority = 0 | 1 | 2;
export const PRIORITY_DEFAULT: Priority = 1;

/** Chip order: highest first. */
export const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 2, label: "Agora" },
  { value: 1, label: "Em breve" },
  { value: 0, label: "Um dia" },
];

export const PRIORITY_LABEL: Record<Priority, string> = { 0: "Um dia", 1: "Em breve", 2: "Agora" };

/** Clamps any stored number to a known level. */
export function priorityOf(p: number): Priority {
  return p >= 2 ? 2 : p <= 0 ? 0 : 1;
}

/** Rooms used by the items (trimmed, no case-insensitive duplicates). */
export function roomsInUse(items: ItemView[]): string[] {
  return dedupe(items.map((v) => v.item.room ?? ""));
}

/** Combobox suggestions: the settings list (or the defaults when empty) plus every room already in use. */
export function roomOptions(settingsRooms: string[], items: ItemView[]): string[] {
  const base = dedupe(settingsRooms).length > 0 ? settingsRooms : DEFAULT_ROOMS;
  return dedupe([...base, ...roomsInUse(items)]);
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const r = raw.trim();
    const k = r.toLocaleLowerCase("pt-BR");
    if (!r || seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/** Group key of the "room" grouping. Prefixed so it never collides with a category of the same name. */
export const roomGroupKey = (room: string | null | undefined) => `room:${(room ?? "").trim().toLocaleLowerCase("pt-BR")}`;
