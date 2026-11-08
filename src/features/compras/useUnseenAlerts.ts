import { useEffect, useState } from "react";
import { comprasListAlertEvents, onComprasAlert } from "@/api";
import { ALERTS_CHANGED_EVENT } from "./alertFeed";

/** Number of unseen alert events. Fetched on mount and refreshed on compras://alert and after marking seen. */
export function useUnseenAlerts(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () => {
      comprasListAlertEvents(500, true)
        .then((evs) => alive && setCount(new Set(evs.map((e) => e.id)).size))
        .catch(() => {});
    };
    load();
    const unlisten = onComprasAlert(load);
    window.addEventListener(ALERTS_CHANGED_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(ALERTS_CHANGED_EVENT, load);
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  return count;
}
