import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { comprasHistory } from "@/api";
import { cn } from "@/lib/utils";
import type { HistoryPoint, OfferView } from "@/types";
import { formatDay } from "./format";
import { formatBRL, formatBRLCompact } from "./money";

const WINDOWS: { label: string; days: number | null }[] = [
  { label: "30 dias", days: 30 },
  { label: "90 dias", days: 90 },
  { label: "180 dias", days: 180 },
  { label: "Tudo", days: null },
];

// Chart colours mirror the cm tokens (recharts needs raw values).
const INK = "#ffffff";
const HAIRLINE = "#3c3c3c";
const MUTED = "#8a8a8a";
const ACCENT = "#2dc98a";
const OFFER_COLORS = ["#8a8a8a", "#7d96ad", "#ad9f7d", "#9a7dad", "#7dad9a", "#ad7d7d"];
const TOOLTIP_STYLE = { background: "#0d0d0d", border: `1px solid ${HAIRLINE}`, borderRadius: 0, fontSize: 12, color: "#e6e6e6" };

interface PriceChartProps {
  itemId: string;
  offers: OfferView[];
  /** Dashed "avisar em" line; null hides it. */
  targetCents: number | null;
  /** Changes whenever the item reloads, so the chart refetches. */
  refreshKey: string;
}

export function PriceChart({ itemId, offers, targetCents, refreshKey }: PriceChartProps) {
  const [days, setDays] = useState<number | null>(90);
  const [points, setPoints] = useState<HistoryPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    comprasHistory(itemId, days)
      .then((p) => {
        if (!cancelled) {
          setPoints(p);
          setError(null);
        }
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [itemId, days, refreshKey]);

  const { rows, offerKeys } = useMemo(() => {
    const keys = new Set<string>();
    const out = (points ?? []).map((p) => {
      const row: Record<string, number | string | null> = { date: p.date, best: p.bestFinalCents };
      for (const [id, v] of Object.entries(p.perOffer)) {
        row[id] = v;
        if (v != null) keys.add(id);
      }
      return row;
    });
    return { rows: out, offerKeys: Array.from(keys) };
  }, [points]);

  const storeOf = (id: string) => offers.find((o) => o.id === id)?.store ?? "Loja removida";
  const sparse = rows.length < 4;

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Período do histórico" className="flex flex-wrap gap-x-6 gap-y-1">
        {WINDOWS.map((w) => {
          const active = days === w.days;
          return (
            <button
              key={w.label}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setDays(w.days)}
              className={cn(
                "border-b-2 pb-1.5 pt-1 text-[12px] font-bold uppercase tracking-[1.5px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cm-ink",
                active ? "border-cm-accent text-cm-ink" : "border-transparent text-cm-muted hover:text-cm-ink"
              )}
            >
              {w.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <p className="py-8 text-center text-[13px] text-cm-danger">{error}</p>
      ) : points == null ? (
        <p className="py-8 text-center text-[13px] font-light text-cm-muted">Carregando histórico…</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-[13px] font-light text-cm-muted">
          Ainda sem histórico. Os pontos aparecem conforme os preços são verificados ou informados.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={HAIRLINE} strokeOpacity={0.7} vertical={false} />
            <XAxis dataKey="date" tickFormatter={formatDay} tick={{ fill: MUTED, fontSize: 11 }} axisLine={{ stroke: HAIRLINE }} tickLine={false} minTickGap={28} />
            <YAxis
              width={68}
              domain={["auto", "auto"]}
              tick={{ fill: MUTED, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => formatBRLCompact(v)}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              cursor={{ stroke: MUTED, strokeDasharray: "2 3" }}
              labelFormatter={(l) => formatDay(String(l))}
              formatter={(value) => formatBRL(Number(value))}
            />
            {offerKeys.length > 0 && <Legend iconType="plainline" wrapperStyle={{ fontSize: 11, color: MUTED, paddingTop: 8 }} />}
            {targetCents != null && (
              <ReferenceLine
                y={targetCents}
                stroke={ACCENT}
                strokeWidth={1.5}
                strokeDasharray="5 4"
                ifOverflow="extendDomain"
                label={{ value: "avisar em", fill: ACCENT, fontSize: 11, position: "insideBottomLeft" }}
              />
            )}
            {offerKeys.map((id, i) => (
              <Line
                key={id}
                type="stepAfter"
                dataKey={id}
                name={storeOf(id)}
                stroke={OFFER_COLORS[i % OFFER_COLORS.length]}
                strokeWidth={1}
                strokeOpacity={0.5}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
            <Line type="stepAfter" dataKey="best" name="Melhor preço" stroke={INK} strokeWidth={2} dot={sparse ? { r: 3, fill: INK } : false} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
