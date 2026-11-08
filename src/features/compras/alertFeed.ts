// Pure helpers for the Alertas feed: dedupe, filter and day grouping.
import type { AlertEvent } from "@/types";

export type AlertFilter = "all" | "unseen" | "target" | "new_low";

export const ALERT_FILTER_LABEL: Record<AlertFilter, string> = {
  all: "Todos",
  unseen: "Não vistos",
  target: "Preço desejado",
  new_low: "Novo menor preço",
};

/** Keeps one event per id (the last copy wins, so a delivered copy replaces a pending one); newest first. */
export function dedupeEvents(events: AlertEvent[]): AlertEvent[] {
  const byId = new Map<string, AlertEvent>();
  for (const e of events) byId.set(e.id, e);
  return Array.from(byId.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function matchesFilter(e: AlertEvent, f: AlertFilter): boolean {
  switch (f) {
    case "unseen":
      return !e.seen;
    case "target":
      return e.kind === "target";
    case "new_low":
      return e.kind === "new_low";
    default:
      return true;
  }
}

function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "Hoje", "Ontem" or a long local date, relative to `now`. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Sem data";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const k = dayKey(d);
  if (k === dayKey(now)) return "Hoje";
  if (k === dayKey(yesterday)) return "Ontem";
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("pt-BR", sameYear ? { day: "2-digit", month: "long" } : { day: "2-digit", month: "long", year: "numeric" });
}

export interface DayGroup {
  key: string;
  label: string;
  events: AlertEvent[];
}

/** Groups an already-sorted (newest first) list by local day, keeping order. */
export function groupByDay(events: AlertEvent[], now: Date = new Date()): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const e of events) {
    const d = new Date(e.createdAt);
    const key = Number.isNaN(d.getTime()) ? "invalid" : dayKey(d);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.events.push(e);
    else groups.push({ key, label: dayLabel(e.createdAt, now), events: [e] });
  }
  return groups;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Snoozed right now? */
export function isSnoozed(until: string | null | undefined, now: number = Date.now()): boolean {
  if (!until) return false;
  const t = Date.parse(until);
  return !Number.isNaN(t) && t > now;
}

/** Window event used so the sidebar badge refreshes after the feed marks events as seen. */
export const ALERTS_CHANGED_EVENT = "compras-alerts-changed";
export function notifyAlertsChanged() {
  window.dispatchEvent(new Event(ALERTS_CHANGED_EVENT));
}
