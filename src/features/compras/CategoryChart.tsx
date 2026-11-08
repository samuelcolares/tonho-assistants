import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CategoryBudget } from "@/types";
import { formatBRL, formatBRLCompact } from "./money";

const TOOLTIP_STYLE = { background: "#1a1a1a", border: "1px solid #3c3c3c", borderRadius: 0, fontSize: 12, color: "#e6e6e6" };

/** Orçado vs comprado vs a preço atual, per category. Values arrive in cents. */
export function CategoryChart({ data }: { data: CategoryBudget[] }) {
  if (data.length === 0) return <p className="py-6 text-center text-[13px] text-cm-muted">Sem categorias.</p>;
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, 64 * data.length + 70)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }} barCategoryGap="22%">
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: "#8a8a8a", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => formatBRLCompact(v)}
        />
        <YAxis
          type="category"
          dataKey="category"
          width={110}
          tick={{ fill: "#e6e6e6", fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: "rgba(255,255,255,0.05)" }}
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: "#ffffff" }}
          formatter={(value) => formatBRL(Number(value))}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "#bbbbbb" }} />
        <Bar dataKey="budgetCents" name="Orçado" fill="#3c3c3c" />
        <Bar dataKey="boughtCents" name="Comprado" fill="#2dc98a" />
        <Bar dataKey="currentCents" name="A preço atual" fill="#ffffff" />
      </BarChart>
    </ResponsiveContainer>
  );
}
