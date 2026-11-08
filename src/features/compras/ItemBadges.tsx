import { cn } from "@/lib/utils";
import type { ItemView } from "@/types";
import { hasStatus } from "./calc";
import { STATUS_INFO, type StatusVariant } from "./labels";

interface BadgeSpec {
  key: string;
  label: string;
  variant: StatusVariant;
  title?: string;
}

const TONE: Record<StatusVariant, string> = {
  default: "border-cm-hairline text-cm-body",
  success: "border-cm-accent text-cm-accent",
  warning: "border-cm-warn text-cm-warn",
  danger: "border-cm-danger text-cm-danger",
};

/** Small sharp tag, shared by badges and the status labels of offers. */
export function CmTag({ variant = "default", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { variant?: StatusVariant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-none border px-1.5 text-[10.5px] font-bold uppercase leading-4 tracking-[1px]",
        TONE[variant],
        className
      )}
      {...props}
    />
  );
}

export function ItemBadges({ view }: { view: ItemView }) {
  const { stats, item } = view;
  const out: BadgeSpec[] = [];

  if (item.bought) {
    out.push({ key: "bought", label: "Comprado", variant: "success" });
  } else {
    if (stats.isHistoricalLow)
      out.push({ key: "low", label: "Menor já visto", variant: "success", title: "O preço de hoje é o menor que já registramos" });
    if (stats.belowTarget)
      out.push({ key: "target", label: "No preço desejado", variant: "success", title: "O preço de hoje está no valor do aviso ou abaixo dele" });
    if (stats.aboveMedian && !stats.isHistoricalLow && !stats.belowTarget)
      out.push({ key: "median", label: "Acima do típico", variant: "warning", title: "O preço de hoje está acima do preço típico dos últimos 90 dias" });
  }
  for (const status of ["suspect", "blocked", "broken"] as const) {
    if (hasStatus(view, status)) {
      const s = STATUS_INFO[status];
      out.push({ key: status, label: s.label, variant: s.variant, title: s.hint });
    }
  }
  if (view.offers.some((o) => o.status === "manual" || o.adapter === "manual")) {
    const s = STATUS_INFO.manual;
    out.push({ key: "manual", label: s.label, variant: s.variant, title: s.hint });
  }

  if (out.length === 0) return null;
  return (
    <>
      {out.map((b) => (
        <CmTag key={b.key} variant={b.variant} title={b.title}>
          {b.label}
        </CmTag>
      ))}
    </>
  );
}
