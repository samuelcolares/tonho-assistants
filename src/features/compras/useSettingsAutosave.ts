import { useCallback, useEffect, useRef, useState } from "react";
import { comprasGetSettings, comprasSaveSettings } from "@/api";
import type { ComprasSettings } from "@/types";
import { errorMessage } from "./format";

export type SaveState = "idle" | "saving" | "saved" | "error";

const DEBOUNCE_MS = 600;

/** Loads the settings and saves every change automatically (debounced, one request at a time). */
export function useSettingsAutosave() {
  const [settings, setSettings] = useState<ComprasSettings | null>(null);
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<ComprasSettings | null>(null);
  const dirty = useRef(false);
  const inFlight = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const alive = useRef(true);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (inFlight.current) return; // the running save re-checks `dirty` when it ends
    while (dirty.current && latest.current) {
      dirty.current = false;
      inFlight.current = true;
      if (alive.current) setState("saving");
      try {
        await comprasSaveSettings(latest.current);
        if (alive.current) {
          setState("saved");
          setError(null);
        }
      } catch (e) {
        dirty.current = false;
        if (alive.current) {
          setState("error");
          setError(errorMessage(e));
        }
      } finally {
        inFlight.current = false;
      }
    }
  }, []);

  const reload = useCallback(async () => {
    const s = await comprasGetSettings();
    latest.current = s;
    dirty.current = false;
    if (alive.current) {
      setSettings(s);
      setState("idle");
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    reload().catch((e) => {
      if (alive.current) {
        setState("error");
        setError(errorMessage(e));
      }
    });
    return () => {
      alive.current = false;
      window.clearTimeout(timer.current);
      if (dirty.current) void flush(); // do not lose a pending edit when leaving the page
    };
  }, [reload, flush]);

  const update = useCallback(
    (patch: Partial<ComprasSettings>) => {
      if (!latest.current) return;
      const next = { ...latest.current, ...patch };
      latest.current = next;
      dirty.current = true;
      setSettings(next);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), DEBOUNCE_MS);
    },
    [flush]
  );

  return { settings, state, error, update, reload };
}
