import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { CmButton, CmIconButton, CmInput } from "./ui";

interface Row {
  store: string;
  pct: string;
}

const toRows = (m: Record<string, number>): Row[] => Object.entries(m).map(([store, pct]) => ({ store, pct: String(pct) }));

/** Only rows with a store name and a percentage in [0, 100) reach the settings. */
export function rowsToMap(rows: Row[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const store = r.store.trim();
    const pct = Number(r.pct.replace(",", "."));
    if (store && r.pct.trim() !== "" && Number.isFinite(pct) && pct >= 0 && pct < 100) out[store] = pct;
  }
  return out;
}

/** "Pix % por loja": the app estimates the Pix price as list price minus this discount when the page has none. */
export function PixRowsEditor({ value, onChange }: { value: Record<string, number>; onChange: (m: Record<string, number>) => void }) {
  // rows keep half-typed values locally; only valid ones are sent up
  const [rows, setRows] = useState<Row[]>(() => toRows(value));

  const apply = (next: Row[]) => {
    setRows(next);
    onChange(rowsToMap(next));
  };

  return (
    <div className="flex flex-col gap-3 border-t border-cm-hairline pt-4">
      <div>
        <p className="text-[14px] font-bold text-cm-ink">Desconto no Pix por loja</p>
        <p className="mt-1 max-w-xl text-[13px] font-light text-cm-muted">
          Quando a página da loja não mostra o preço no Pix, o app estima: preço cheio menos esse desconto.
        </p>
      </div>
      {rows.length === 0 && <p className="text-[13px] font-light text-cm-muted">Nenhuma loja configurada.</p>}
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-3">
          <CmInput
            aria-label="Loja"
            className="w-56"
            value={r.store}
            placeholder="Loja (ex.: Amazon)"
            onChange={(e) => apply(rows.map((x, j) => (j === i ? { ...x, store: e.target.value } : x)))}
          />
          <div className="relative w-28">
            <CmInput
              aria-label={`Desconto no Pix em ${r.store || "loja"}`}
              inputMode="decimal"
              className="pr-8"
              value={r.pct}
              onChange={(e) => apply(rows.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))}
            />
            <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] font-bold text-cm-muted">
              %
            </span>
          </div>
          <CmIconButton aria-label="Remover loja" size="sm" onClick={() => apply(rows.filter((_, j) => j !== i))}>
            <Trash2 className="h-4 w-4" />
          </CmIconButton>
        </div>
      ))}
      <CmButton size="sm" className="w-fit" onClick={() => apply([...rows, { store: "", pct: "5" }])}>
        <Plus className="h-4 w-4" /> Adicionar loja
      </CmButton>
    </div>
  );
}
