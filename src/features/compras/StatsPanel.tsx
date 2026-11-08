import { useState } from "react";
import { ChevronDown, ChevronRight, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ItemView, PriceRange } from "@/types";
import { TREND_LABEL } from "./labels";
import { formatBRL } from "./money";
import { CmCard, CmStripe } from "./ui";

function Stat({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1" title={hint}>
      <span className="text-[11px] font-bold uppercase tracking-[1.5px] text-cm-muted">{label}</span>
      <span className={cn("text-[15px] font-bold tabular-nums", accent ? "text-cm-accent" : "text-cm-ink")}>{value}</span>
    </div>
  );
}

const pos = (v: number, min: number, max: number) => (max > min ? Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100)) : 50);

/** Min..max track, the usual band (low-to-high thresholds) and a marker for the current price. */
export function RangeBar({ range }: { range: PriceRange }) {
  const { minCents: min, maxCents: max, p25Cents: p25, p75Cents: p75, currentCents: cur } = range;
  const a = pos(p25, min, max);
  const b = pos(p75, min, max);
  const c = pos(cur, min, max);
  return (
    <div
      className="flex flex-col gap-2"
      role="img"
      aria-label={`Preço de hoje ${formatBRL(cur)}. Menor ${formatBRL(min)}, baixo até ${formatBRL(p25)}, alto a partir de ${formatBRL(p75)}, maior ${formatBRL(max)}.`}
    >
      <div className="relative h-6">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-cm-hairline" />
        <div className="absolute left-0 top-1/2 h-3 w-px -translate-y-1/2 bg-cm-muted" />
        <div className="absolute right-0 top-1/2 h-3 w-px -translate-y-1/2 bg-cm-muted" />
        <div
          className="absolute top-1/2 h-2 -translate-y-1/2 bg-cm-hairline"
          style={{ left: `${a}%`, width: `${Math.max(b - a, 0.5)}%` }}
          title="Faixa em que o preço costuma ficar"
        />
        <div className="absolute top-0 h-6 w-[3px] -translate-x-1/2 bg-cm-accent" style={{ left: `${c}%` }} title={`Hoje: ${formatBRL(cur)}`} />
      </div>
      <div className="flex items-center justify-between text-[12px] font-light tabular-nums text-cm-muted">
        <span>{formatBRL(min)}</span>
        <span className="font-bold text-cm-accent">Hoje {formatBRL(cur)}</span>
        <span>{formatBRL(max)}</span>
      </div>
    </div>
  );
}

export function StatsPanel({ view }: { view: ItemView }) {
  const { stats, best, range } = view;
  const [details, setDetails] = useState(false);
  const trend =
    stats.trend === "down"
      ? { label: TREND_LABEL.down, icon: <TrendingDown className="h-4 w-4" />, cls: "text-cm-accent" }
      : stats.trend === "up"
        ? { label: TREND_LABEL.up, icon: <TrendingUp className="h-4 w-4" />, cls: "text-cm-warn" }
        : stats.trend === "flat"
          ? { label: TREND_LABEL.flat, icon: <Minus className="h-4 w-4" />, cls: "text-cm-body" }
          : null;
  const Chevron = details ? ChevronDown : ChevronRight;

  return (
    <CmCard outlined className="flex flex-col gap-5 p-0">
      <CmStripe />
      <div className="flex flex-col gap-5 px-6 pb-6">
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-bold uppercase tracking-[1.5px] text-cm-muted">Melhor preço agora</span>
          <span className="text-[32px] font-bold leading-none tabular-nums text-cm-ink">{formatBRL(best?.finalCents)}</span>
          {best && (
            <span className="text-[13px] font-light text-cm-body">
              {best.store}
              {!best.shippingKnown && <span className="ml-2 font-bold text-cm-warn">+ frete ?</span>}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Stat label="Menor já visto" value={formatBRL(stats.allTimeLowCents)} hint="Menor preço que já registramos para este item" />
          <Stat label="Preço típico" value={formatBRL(stats.medianCents)} hint="O valor do meio dos últimos 90 dias" />
          <div className="col-span-2">
            <Stat
              label="Baixo até – Alto a partir de"
              value={stats.p25Cents != null && stats.p75Cents != null ? `${formatBRL(stats.p25Cents)} – ${formatBRL(stats.p75Cents)}` : "—"}
              hint="Abaixo do primeiro valor o preço é bom; acima do segundo, caro"
            />
          </div>
        </div>

        {range ? (
          <RangeBar range={range} />
        ) : (
          <p className="text-[13px] font-light text-cm-muted">Ainda sem histórico para mostrar a faixa de preços.</p>
        )}

        <div className="flex items-center gap-2 text-[13px]">
          <span className="text-[12px] font-bold uppercase tracking-[1.5px] text-cm-muted">Tendência</span>
          {trend ? (
            <span className={cn("inline-flex items-center gap-1 font-bold", trend.cls)}>
              {trend.icon} {trend.label}
            </span>
          ) : (
            <span className="font-light text-cm-muted" title="Precisamos de pelo menos 7 dias de preços">
              ainda sem dados
            </span>
          )}
        </div>

        <div className="border-t border-cm-hairline pt-4">
          <button
            type="button"
            onClick={() => setDetails((d) => !d)}
            aria-expanded={details}
            className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[1.5px] text-cm-muted hover:text-cm-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cm-ink"
          >
            <Chevron className="h-4 w-4" /> Ver detalhes
          </button>
          {details && (
            <div className="mt-4 flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                <Stat label="Média sem extremos" value={formatBRL(stats.trimmedMeanCents)} hint="Média sem contar os preços muito fora do comum" />
                <Stat label="Maior preço" value={formatBRL(stats.maxCents)} hint="O preço mais alto dos últimos 90 dias" />
                <Stat label="Menor (90 dias)" value={formatBRL(stats.minCents)} />
                <Stat label="Dias com preço" value={String(stats.samples)} />
              </div>
              <p className="text-[12px] font-light text-cm-muted">
                Baseado nos últimos {stats.windowDays} dias, só com preços confirmados.
              </p>
            </div>
          )}
        </div>
      </div>
    </CmCard>
  );
}
