import { cn } from "@/lib/utils";

interface SparklineProps {
  /** Daily points; null = no data that day. */
  points: (number | null)[] | null | undefined;
  trend: "down" | "up" | "flat" | null | undefined;
  width?: number;
  height?: number;
  className?: string;
}

/** Tiny price line: accent when falling, warn when rising, muted otherwise. Nothing with fewer than 2 points. */
export function Sparkline({ points, trend, width = 90, height = 28, className }: SparklineProps) {
  const pts = (points ?? []).map((p, i) => ({ p, i })).filter((x): x is { p: number; i: number } => x.p != null);
  if (pts.length < 2) return null;
  const n = (points ?? []).length;
  const min = Math.min(...pts.map((x) => x.p));
  const max = Math.max(...pts.map((x) => x.p));
  const pad = 2;
  const x = (i: number) => pad + (i / Math.max(1, n - 1)) * (width - pad * 2);
  const y = (v: number) => (max === min ? height / 2 : pad + (1 - (v - min) / (max - min)) * (height - pad * 2));
  const d = pts.map((q, k) => `${k === 0 ? "M" : "L"}${x(q.i).toFixed(1)} ${y(q.p).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const tone = trend === "down" ? "text-cm-accent" : trend === "up" ? "text-cm-warn" : "text-cm-muted";
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Preço nos últimos 30 dias"
      className={cn("shrink-0", tone, className)}
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.i)} cy={y(last.p)} r={2} fill="currentColor" />
    </svg>
  );
}
