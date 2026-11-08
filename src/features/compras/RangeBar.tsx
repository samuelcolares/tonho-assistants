import { cn } from "@/lib/utils";
import type { PriceRange } from "@/types";
import { formatBRL } from "./money";

const pos = (v: number, min: number, max: number) => (max > min ? Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100)) : 50);

/**
 * 90-day range: hairline track from the lowest to the highest price, a thick segment for the usual band
 * (low-to-high thresholds) and an accent marker for today's price. Three captions underneath.
 */
export function RangeBar({ range }: { range: PriceRange }) {
  const { minCents: min, maxCents: max, p25Cents: p25, p75Cents: p75, currentCents: cur } = range;
  const a = pos(p25, min, max);
  const b = pos(p75, min, max);
  const c = pos(cur, min, max);
  // Keep the "hoje" label inside the bar: anchor left/right near the edges.
  const labelCls = c < 22 ? "left-0" : c > 78 ? "right-0" : "-translate-x-1/2";
  return (
    <div
      className="flex flex-col gap-3"
      role="img"
      aria-label={`Preço de hoje ${formatBRL(cur)}. Menor ${formatBRL(min)}, costuma ficar entre ${formatBRL(p25)} e ${formatBRL(p75)}, maior ${formatBRL(max)}.`}
    >
      <div className="relative h-14">
        <span
          className={cn("absolute top-0 whitespace-nowrap text-[12px] font-bold uppercase tracking-[1.5px] tabular-nums text-cm-accent", labelCls)}
          style={c < 22 || c > 78 ? undefined : { left: `${c}%` }}
        >
          Hoje {formatBRL(cur)}
        </span>
        <div className="absolute inset-x-0 bottom-3 h-px bg-cm-hairline" />
        <div className="absolute bottom-[7px] left-0 h-3 w-px bg-cm-muted" />
        <div className="absolute bottom-[7px] right-0 h-3 w-px bg-cm-muted" />
        <div
          className="absolute bottom-[8px] h-[10px] bg-cm-hairline"
          style={{ left: `${a}%`, width: `${Math.max(b - a, 1)}%` }}
          title="Faixa em que o preço costuma ficar"
        />
        <div className="absolute bottom-0 h-7 w-[3px] -translate-x-1/2 bg-cm-accent" style={{ left: `${c}%` }} title={`Hoje: ${formatBRL(cur)}`} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-[12px] font-light tabular-nums text-cm-body">
        <span className="flex min-w-0 flex-col">
          <span className="text-[11px] font-bold uppercase tracking-[1.5px] text-cm-muted">Menor</span>
          {formatBRL(min)}
        </span>
        <span className="flex min-w-0 flex-col text-center">
          <span className="text-[11px] font-bold uppercase tracking-[1.5px] text-cm-muted">Costuma ficar</span>
          <span>
            {formatBRL(p25)} – {formatBRL(p75)}
          </span>
        </span>
        <span className="flex min-w-0 flex-col text-right">
          <span className="text-[11px] font-bold uppercase tracking-[1.5px] text-cm-muted">Maior</span>
          {formatBRL(max)}
        </span>
      </div>
    </div>
  );
}
