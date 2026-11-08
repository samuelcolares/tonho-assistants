import { useCallback, useEffect, useRef, useState } from "react";
import {
  comprasBudgetSummary,
  comprasGetSettings,
  comprasListItems,
  comprasListTemplates,
  comprasPollStatus,
  onComprasAlert,
  onComprasPollStatus,
  onComprasUpdated,
} from "@/api";
import { useToast } from "@/hooks/use-toast";
import type { BudgetSummary, CategoryTemplate, ItemView, PollStatus } from "@/types";
import { errorMessage } from "./format";

export interface ComprasData {
  /** Active items (archived ones are in `archived`). */
  items: ItemView[] | null;
  /** Archived items, for the ARQUIVADOS tab. */
  archived: ItemView[];
  /** Rooms the user listed in the settings (empty = use the default suggestions). */
  settingsRooms: string[];
  summary: BudgetSummary | null;
  templates: CategoryTemplate[];
  pollStatus: PollStatus | null;
  error: string | null;
  reload: () => Promise<void>;
}

/** Loads items/summary/templates and keeps them fresh via compras:// events. */
export function useComprasData(): ComprasData {
  const [items, setItems] = useState<ItemView[] | null>(null);
  const [archived, setArchived] = useState<ItemView[]>([]);
  const [settingsRooms, setSettingsRooms] = useState<string[]>([]);
  const [summary, setSummary] = useState<BudgetSummary | null>(null);
  const [templates, setTemplates] = useState<CategoryTemplate[]>([]);
  const [pollStatus, setPollStatus] = useState<PollStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const seenAlerts = useRef<Set<string>>(new Set());

  const reload = useCallback(async () => {
    try {
      const [i, s, cfg] = await Promise.all([
        comprasListItems(true),
        comprasBudgetSummary(),
        comprasGetSettings().catch(() => null), // room suggestions only: never blocks the list
      ]);
      if (!alive.current) return;
      if (cfg) setSettingsRooms(cfg.rooms ?? []);
      setItems(i.filter((v) => !v.item.archived));
      setArchived(i.filter((v) => v.item.archived));
      setSummary(s);
      setError(null);
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    reload();
    comprasListTemplates()
      .then((t) => alive.current && setTemplates(t))
      .catch(() => {});
    comprasPollStatus()
      .then((p) => alive.current && setPollStatus(p))
      .catch(() => {});

    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(reload, 250);
    };
    const unlistenUpdated = onComprasUpdated(schedule);
    const unlistenStatus = onComprasPollStatus((p) => setPollStatus(p));
    // In-app toast for each alert (deduped by event id), then refresh so bells/targets reflect the new state.
    const unlistenAlert = onComprasAlert((ev) => {
      if (seenAlerts.current.has(ev.id)) return;
      seenAlerts.current.add(ev.id);
      toastRef.current({
        variant: "success",
        title: ev.title || `Chegou no preço: ${ev.itemName}`,
        description: ev.reason,
      });
      schedule();
    });

    return () => {
      alive.current = false;
      window.clearTimeout(timer);
      unlistenUpdated.then((fn) => fn()).catch(() => {});
      unlistenStatus.then((fn) => fn()).catch(() => {});
      unlistenAlert.then((fn) => fn()).catch(() => {});
    };
  }, [reload]);

  return { items, archived, settingsRooms, summary, templates, pollStatus, error, reload };
}
