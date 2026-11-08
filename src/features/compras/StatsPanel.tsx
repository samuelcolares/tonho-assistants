import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ItemView } from "@/types";
import { TREND_LABEL } from "./labels";
import { formatBRL } from "./money";

function Stat({ label, value, hint, className }: { label: string; value: React.ReactNode; hint?: string; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 bg-cm-canvas p-4", className)} title={hint}>
      <span className="text-[11px] font-bold uppercase tracking-[1.5px] text-cm-muted">{label}</span>
      <span className="text-[16px] font-bold tabular-nums text-cm-ink">{value}</span>
    </div>
  );
}

/** Numbers behind the verdict, shown under "Ver estatísticas" (hairline grid, no chrome). */
export function StatsPanel({ view }: { view: ItemView }) {
  const { stats } = view;
  const trend =
    stats.trend === "down"
      ? { label: TREND_LABEL.down, icon: <TrendingDown className="h-4 w-4" />, cls: "text-cm-accent" }
      : stats.trend === "up"
        ? { label: TREND_LABEL.up, icon: <TrendingUp className="h-4 w-4" />, cls: "text-cm-warn" }
        : stats.trend === "flat"
          ? { label: TREND_LABEL.flat, icon: <Minus className="h-4 w-4" />, cls: "text-cm-body" }
          : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-px border border-cm-hairline bg-cm-hairline md:grid-cols-4">
        <Stat label="Menor já visto" value={formatBRL(stats.allTimeLowCents)} hint="Menor preço que já registramos para este item" />
        <Stat label="Preço típico" value={formatBRL(stats.medianCents)} hint="O valor do meio dos últimos 90 dias" />
        <Stat label="Média sem extremos" value={formatBRL(stats.trimmedMeanCents)} hint="Média sem contar os preços muito fora do comum" />
        <Stat
          label="Tendência"
          hint="Precisamos de pelo menos 7 dias de preços"
          value={
            trend ? (
              <span className={cn("inline-flex items-center gap-1.5", trend.cls)}>
                {trend.icon} {trend.label}
              </span>
            ) : (
              <span className="text-[14px] font-light text-cm-muted">ainda sem dados</span>
            )
          }
        />
        <Stat label="Baixo até" value={formatBRL(stats.p25Cents)} hint="Abaixo deste valor o preço é bom" />
        <Stat label="Alto a partir de" value={formatBRL(stats.p75Cents)} hint="Acima deste valor o preço é caro" />
        <Stat label="Menor (90 dias)" value={formatBRL(stats.minCents)} />
        <Stat label="Maior (90 dias)" value={formatBRL(stats.maxCents)} hint="O preço mais alto dos últimos 90 dias" />
      </div>
      <p className="text-[12px] font-light text-cm-muted">
        Baseado nos últimos {stats.windowDays} dias, só com preços confirmados ({stats.samples} {stats.samples === 1 ? "dia" : "dias"} com preço).
      </p>
    </div>
  );
}
