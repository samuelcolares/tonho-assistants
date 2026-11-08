import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { CategoryTemplate, SpecField } from "@/types";
import { Field } from "./shared";
import { specKeysOf } from "./templates";

const CLEAR = "__clear__";

interface FreeRow {
  key: string;
  value: string;
}

interface SpecsFormProps {
  template: CategoryTemplate | null;
  specs: Record<string, string>;
  onChange: (specs: Record<string, string>) => void;
}

/**
 * Template-driven spec fields plus free key/value rows. Mount with a `key` that changes when the
 * template or the underlying item is reset, so free rows are recomputed.
 */
export function SpecsForm({ template, specs, onChange }: SpecsFormProps) {
  const templateKeys = specKeysOf(template);
  const [free, setFree] = useState<FreeRow[]>(() =>
    Object.entries(specs)
      .filter(([k]) => !templateKeys.has(k))
      .map(([key, value]) => ({ key, value }))
  );

  const templateValues = (): Record<string, string> =>
    Object.fromEntries(Object.entries(specs).filter(([k]) => templateKeys.has(k)));

  const emit = (tpl: Record<string, string>, rows: FreeRow[]) => {
    const out: Record<string, string> = { ...tpl };
    for (const r of rows) {
      const k = r.key.trim();
      if (k && !templateKeys.has(k)) out[k] = r.value;
    }
    onChange(out);
  };

  const setTemplateValue = (key: string, value: string) => {
    const tpl = templateValues();
    if (value === "") delete tpl[key];
    else tpl[key] = value;
    emit(tpl, free);
  };

  const updateFree = (rows: FreeRow[]) => {
    setFree(rows);
    emit(templateValues(), rows);
  };

  return (
    <div className="flex flex-col gap-4">
      {template && template.fields.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {template.fields.map((f) => (
            <SpecInput key={f.key} field={f} value={specs[f.key] ?? ""} onChange={(v) => setTemplateValue(f.key, v)} />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Outras especificações</span>
          <Button size="sm" variant="ghost" onClick={() => setFree([...free, { key: "", value: "" }])}>
            <Plus className="h-3.5 w-3.5" /> Adicionar
          </Button>
        </div>
        {free.length === 0 && <p className="text-[12.5px] text-ink-faint">Nenhuma. Use para voltagem, cor, material…</p>}
        {free.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              className="w-40"
              placeholder="Nome"
              value={r.key}
              onChange={(e) => updateFree(free.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
            />
            <Input
              placeholder="Valor"
              value={r.value}
              onChange={(e) => updateFree(free.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
            />
            <Button size="icon" variant="ghost" aria-label="Remover especificação" onClick={() => updateFree(free.filter((_, j) => j !== i))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SpecInput({ field, value, onChange }: { field: SpecField; value: string; onChange: (v: string) => void }) {
  const label = field.unit ? `${field.label} (${field.unit})` : field.label;
  switch (field.kind) {
    case "bool":
      return (
        <Field label={label}>
          <div className="flex h-9 items-center gap-2">
            <Switch checked={value === "true"} onCheckedChange={(v) => onChange(v ? "true" : "false")} />
            <span className="text-[13px] text-ink-muted">{value === "true" ? "Sim" : value === "false" ? "Não" : "—"}</span>
          </div>
        </Field>
      );
    case "enum":
      return (
        <Field label={label}>
          <Select value={value === "" ? CLEAR : value} onValueChange={(v) => onChange(v === CLEAR ? "" : v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CLEAR}>—</SelectItem>
              {(field.options ?? []).map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
              {value !== "" && !(field.options ?? []).includes(value) && <SelectItem value={value}>{value}</SelectItem>}
            </SelectContent>
          </Select>
        </Field>
      );
    case "number":
      return (
        <Field label={label}>
          <Input type="number" value={value} onChange={(e) => onChange(e.target.value)} />
        </Field>
      );
    default:
      return (
        <Field label={label}>
          <Input value={value} onChange={(e) => onChange(e.target.value)} />
        </Field>
      );
  }
}
