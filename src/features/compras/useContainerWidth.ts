import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Width in px of the referenced element (updates on resize). `fallback` is used before the first measure. */
export function useContainerWidth<T extends HTMLElement>(fallback = 900): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || fallback);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => setWidth(Math.round(entries[0].contentRect.width) || fallback));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, width];
}
