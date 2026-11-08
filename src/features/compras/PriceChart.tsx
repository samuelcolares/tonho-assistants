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
const OFFER_COLORS = ["#7c5cff", "#2dd4ee", "#f2933a", "#3b9eff", "#f2c94c", "#f87171"];
const TOOLTIP_STYLE = { background: "#12141d", border: "1px solid #23273a", borderRadius: 8, fontSize: 12 };

interface PriceChartProps {
  itemId: string;
  offers: OfferView[];
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

  const storeOf = (id: string) => offers.find((o) => o.id === id)?.store ?? "Oferta removida";
  const sparse = rows.length < 4;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <div className="inline-flex rounded-md border border-border bg-bg-100 p-0.5">
          {WINDOWS.map((w) => (
            <button
              key={w.label}
              type="button"
              onClick={() => setDays(w.days)}
              className={cn(
                "rounded-[7px] px-3 py-1 text-[12px] font-semibold transition-colors",
                days === w.days ? "bg-compras-subtle text-compras" : "text-ink-muted hover:text-ink"
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="py-8 text-center text-[13px] text-danger">{error}</p>
      ) : points == null ? (
        <p className="py-8 text-center text-[13px] text-ink-faint">Carregando histórico…</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-ink-faint">
          Ainda sem histórico. Os pontos aparecem conforme os preços são verificados ou informados.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#23273a" vertical={false} />
            <XAxis dataKey="date" tickFormatter={formatDay} tick={{ fill: "#9298b3", fontSize: 11 }} axisLine={{ stroke: "#23273a" }} tickLine={false} minTickGap={24} />
            <YAxis
              width={70}
              domain={["auto", "auto"]}
              tick={{ fill: "#9298b3", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => formatBRLCompact(v)}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={(l) => formatDay(String(l))}
              formatter={(value) => formatBRL(Number(value))}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: "#9298b3" }} />
            {targetCents != null && (
              <ReferenceLine y={targetCents} stroke="#f2c94c" strokeDasharray="5 4" label={{ value: "avisar em", fill: "#f2c94c", fontSize: 11, position: "insideTopRight" }} />
            )}
            {offerKeys.map((id, i) => (
              <Line
                key={id}
                type="stepAfter"
                dataKey={id}
                name={storeOf(id)}
                stroke={OFFER_COLORS[i % OFFER_COLORS.length]}
                strokeWidth={1.25}
                strokeOpacity={0.75}
                dot={sparse}
                connectNulls
                isAnimationActive={false}
              />
            ))}
            <Line type="stepAfter" dataKey="best" name="Melhor preço" stroke="#2dc98a" strokeWidth={2.5} dot={sparse ? { r: 3 } : false} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
