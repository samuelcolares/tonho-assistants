import { Badge } from "@/components/ui/badge";
import type { ItemView } from "@/types";
import { hasStatus } from "./calc";

interface BadgeSpec {
  key: string;
  label: string;
  variant: "default" | "success" | "warning" | "danger";
  title?: string;
}

export function ItemBadges({ view }: { view: ItemView }) {
  const { stats, item } = view;
  const out: BadgeSpec[] = [];

  if (item.bought) {
    out.push({ key: "bought", label: "Comprado", variant: "success" });
  } else {
    if (stats.isHistoricalLow)
      out.push({ key: "low", label: "Menor preço histórico", variant: "success", title: "O preço atual é o menor já registrado" });
    if (stats.belowTarget)
      out.push({ key: "target", label: "Abaixo do alvo", variant: "success", title: "O preço atual está no alvo ou abaixo dele" });
    if (stats.aboveMedian && !stats.isHistoricalLow && !stats.belowTarget)
      out.push({ key: "median", label: "Acima da mediana", variant: "warning", title: "Preço atual acima da mediana da janela" });
  }
  if (hasStatus(view, "suspect"))
    out.push({ key: "suspect", label: "Suspeito", variant: "warning", title: "Preço variou demais ou o produto parece outro" });
  if (hasStatus(view, "blocked"))
    out.push({ key: "blocked", label: "Bloqueado", variant: "danger", title: "A loja bloqueia a consulta automática" });
  if (hasStatus(view, "broken"))
    out.push({ key: "broken", label: "Quebrado", variant: "danger", title: "Falha repetida ao ler a página" });
  if (view.offers.some((o) => o.status === "manual" || o.adapter === "manual"))
    out.push({ key: "manual", label: "Manual", variant: "default", title: "Preço informado manualmente" });

  if (out.length === 0) return null;
  return (
    <>
      {out.map((b) => (
        <Badge key={b.key} variant={b.variant} title={b.title} className="whitespace-nowrap text-[10.5px]">
          {b.label}
        </Badge>
      ))}
    </>
  );
}
