import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CategoryBudget } from "@/types";
import { formatBRL, formatBRLCompact } from "./money";

const TOOLTIP_STYLE = { background: "#12141d", border: "1px solid #23273a", borderRadius: 8, fontSize: 12 };

/** Orçado vs comprado vs a preço atual, per category. Values arrive in cents. */
export function CategoryChart({ data }: { data: CategoryBudget[] }) {
  if (data.length === 0) return <p className="py-6 text-center text-[13px] text-ink-faint">Sem categorias.</p>;
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, 64 * data.length + 70)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }} barCategoryGap="22%">
        <CartesianGrid strokeDasharray="3 3" stroke="#23273a" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: "#9298b3", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => formatBRLCompact(v)}
        />
        <YAxis
          type="category"
          dataKey="category"
          width={110}
          tick={{ fill: "#eef0f7", fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: "#eef0f7" }}
          formatter={(value) => formatBRL(Number(value))}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "#9298b3" }} />
        <Bar dataKey="budgetCents" name="Orçado" fill="#5c6280" radius={[0, 3, 3, 0]} />
        <Bar dataKey="boughtCents" name="Comprado" fill="#34d399" radius={[0, 3, 3, 0]} />
        <Bar dataKey="currentCents" name="A preço atual" fill="#7c5cff" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
