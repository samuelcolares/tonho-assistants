import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ItemView } from "@/types";
import { formatBRL } from "./money";

function Stat({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: string }) {
  return (
    <div className="flex flex-col gap-0.5" title={hint}>
      <span className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">{label}</span>
      <span className={cn("text-[14px] font-semibold tabular-nums text-ink", accent)}>{value}</span>
    </div>
  );
}

export function StatsPanel({ view }: { view: ItemView }) {
  const { stats, best } = view;
  const trend =
    stats.trend === "down"
      ? { label: "Em queda", icon: <TrendingDown className="h-4 w-4" />, cls: "text-success" }
      : stats.trend === "up"
        ? { label: "Em alta", icon: <TrendingUp className="h-4 w-4" />, cls: "text-danger" }
        : stats.trend === "flat"
          ? { label: "Estável", icon: <Minus className="h-4 w-4" />, cls: "text-ink-muted" }
          : null;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Melhor preço agora</span>
        <span className="text-3xl font-bold tabular-nums text-compras">{formatBRL(best?.finalCents)}</span>
        {best && (
          <span className="text-[12px] text-ink-muted">
            {best.store}
            {!best.shippingKnown && <span className="ml-1.5 font-semibold text-warning">+ frete ?</span>}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Stat label="Mínimo" value={formatBRL(stats.minCents)} hint="Menor preço na janela" />
        <Stat label="Mediana" value={formatBRL(stats.medianCents)} />
        <Stat label="Média aparada" value={formatBRL(stats.trimmedMeanCents)} hint="Média sem outliers (regra do IQR)" />
        <Stat label="Preço bom (P25)" value={formatBRL(stats.p25Cents)} accent="text-success" hint="25% dos preços ficaram abaixo disso" />
        <Stat label="P75" value={formatBRL(stats.p75Cents)} />
        <Stat label="Máximo" value={formatBRL(stats.maxCents)} />
        <Stat label="Menor histórico" value={formatBRL(stats.allTimeLowCents)} hint="Menor preço confirmado de todos os tempos" />
        <div className="flex flex-col gap-0.5">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">Tendência</span>
          {trend ? (
            <span className={cn("inline-flex items-center gap-1 text-[14px] font-semibold", trend.cls)}>
              {trend.icon} {trend.label}
            </span>
          ) : (
            <span className="text-[14px] text-ink-faint" title="São necessários pelo menos 7 dias de dados">
              —
            </span>
          )}
        </div>
      </div>

      <p className="text-[11.5px] text-ink-faint">
        Janela de {stats.windowDays} dias · {stats.samples} {stats.samples === 1 ? "amostra" : "amostras"} (só preços confirmados).
      </p>
    </Card>
  );
}
