import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { comprasGetItem, comprasUpsertItem } from "@/api";
import type { ComprasItem } from "@/types";
import { errorMessage } from "./format";

export const AUTOSAVE_DEBOUNCE_MS = 600;

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Autosave for the item detail form. Local edits live in `edits` (only the fields the user touched);
 * the effective item is the server item with the edits on top. Each save re-reads the item from the
 * database and applies only the edited fields, so fields changed elsewhere in the meantime (target via
 * the alert dialog, bought flag, image) are never clobbered. Saves are serialised.
 *
 * - `patch(p)`: debounced (600 ms after the last change).
 * - `patch(p, true)`: saves right away (selects, toggles).
 * - `flush(true)`: saves now and trims name/category (blur, leaving the page).
 */
export function useItemAutosave(id: string, serverItem: ComprasItem | null, onSaved: (saved: ComprasItem) => void) {
  const [edits, setEdits] = useState<Partial<ComprasItem>>({});
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorText, setErrorText] = useState<string | null>(null);
  const editsRef = useRef<Partial<ComprasItem>>({});
  const serverRef = useRef<ComprasItem | null>(serverItem);
  serverRef.current = serverItem;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const timer = useRef<number | undefined>(undefined);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  const savedTimer = useRef<number | undefined>(undefined);

  const setBoth = (next: Partial<ComprasItem>) => {
    editsRef.current = next;
    setEdits(next);
  };

  const runSave = useCallback(
    async (final: boolean): Promise<boolean> => {
      let pending = editsRef.current;
      const base = serverRef.current;
      if (final) {
        // Leaving a field (or the page): trim name/category, also when a debounced save stored them untrimmed.
        const merged = { ...base, ...pending } as Partial<ComprasItem>;
        const trimmed: Partial<ComprasItem> = {};
        if (typeof merged.name === "string" && merged.name !== merged.name.trim()) trimmed.name = merged.name.trim();
        if (typeof merged.category === "string" && merged.category !== merged.category.trim()) trimmed.category = merged.category.trim();
        if (Object.keys(trimmed).length > 0) {
          pending = { ...pending, ...trimmed };
          setBoth({ ...editsRef.current, ...trimmed });
        }
      }
      if (Object.keys(pending).length === 0) return true;
      const name = (pending.name ?? base?.name ?? "").trim();
      const category = (pending.category ?? base?.category ?? "").trim();
      if (!name || !category) {
        // Typing in progress: wait quietly. On blur/leave, say what is missing.
        if (final) {
          setStatus("error");
          setErrorText("informe nome e categoria");
        }
        return false;
      }
      window.clearTimeout(savedTimer.current);
      setStatus("saving");
      setErrorText(null);
      try {
        const latest = (await comprasGetItem(id)).item;
        const saved = await comprasUpsertItem({ ...latest, ...pending });
        const rest = { ...editsRef.current } as Record<string, unknown>;
        for (const [k, v] of Object.entries(pending)) {
          if (JSON.stringify(rest[k]) === JSON.stringify(v)) delete rest[k];
        }
        setBoth(rest as Partial<ComprasItem>);
        setStatus("saved");
        savedTimer.current = window.setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 3000);
        onSavedRef.current(saved);
        return true;
      } catch (e) {
        setStatus("error");
        setErrorText(errorMessage(e));
        return false;
      }
    },
    [id]
  );

  const flush = useCallback(
    (final = false): Promise<boolean> => {
      window.clearTimeout(timer.current);
      queue.current = queue.current.then(() => runSave(final));
      return queue.current;
    },
    [runSave]
  );

  const patch = useCallback(
    (p: Partial<ComprasItem>, immediate = false) => {
      setBoth({ ...editsRef.current, ...p });
      setStatus((s) => (s === "saved" ? "idle" : s));
      window.clearTimeout(timer.current);
      if (immediate) void flush(false);
      else timer.current = window.setTimeout(() => void flush(false), AUTOSAVE_DEBOUNCE_MS);
    },
    [flush]
  );

  // No data loss: flush pending edits when leaving the page (unmount) or closing the window.
  useEffect(() => {
    const onUnload = () => void flush(true);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.clearTimeout(timer.current);
      window.clearTimeout(savedTimer.current);
      if (Object.keys(editsRef.current).length > 0) void flush(true);
    };
  }, [flush]);

  /** Drops pending edits without saving (used right before deleting the item). */
  const discard = useCallback(() => {
    window.clearTimeout(timer.current);
    setBoth({});
  }, []);

  const item = useMemo(() => (serverItem ? { ...serverItem, ...edits } : null), [serverItem, edits]);
  return { item, patch, flush, discard, status, errorText, hasPending: Object.keys(edits).length > 0 };
}
