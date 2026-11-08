import { useCallback, useEffect, useRef, useState } from "react";
import {
  comprasBudgetSummary,
  comprasListItems,
  comprasListTemplates,
  comprasPollStatus,
  onComprasPollStatus,
  onComprasUpdated,
} from "@/api";
import type { BudgetSummary, CategoryTemplate, ItemView, PollStatus } from "@/types";
import { errorMessage } from "./format";

export interface ComprasData {
  items: ItemView[] | null;
  summary: BudgetSummary | null;
  templates: CategoryTemplate[];
  pollStatus: PollStatus | null;
  error: string | null;
  reload: () => Promise<void>;
}

/** Loads items/summary/templates and keeps them fresh via compras:// events. */
export function useComprasData(): ComprasData {
  const [items, setItems] = useState<ItemView[] | null>(null);
  const [summary, setSummary] = useState<BudgetSummary | null>(null);
  const [templates, setTemplates] = useState<CategoryTemplate[]>([]);
  const [pollStatus, setPollStatus] = useState<PollStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const [i, s] = await Promise.all([comprasListItems(), comprasBudgetSummary()]);
      if (!alive.current) return;
      setItems(i);
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

    return () => {
      alive.current = false;
      window.clearTimeout(timer);
      unlistenUpdated.then((fn) => fn()).catch(() => {});
      unlistenStatus.then((fn) => fn()).catch(() => {});
    };
  }, [reload]);

  return { items, summary, templates, pollStatus, error, reload };
}
