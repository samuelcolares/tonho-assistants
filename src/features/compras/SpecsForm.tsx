import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CategoryTemplate, SpecField } from "@/types";
import { specKeysOf } from "./templates";
import { CmButton, CmCheckbox, CmField, CmIconButton, CmInput, CmSelect } from "./ui";

interface FreeRow {
  key: string;
  value: string;
}

interface SpecsFormProps {
  template: CategoryTemplate | null;
  specs: Record<string, string>;
  onChange: (specs: Record<string, string>) => void;
  /** Selects and toggles are committed at once; text fields are debounced by the caller. */
  onCommitNow?: (specs: Record<string, string>) => void;
}

/**
 * Template-driven spec fields plus free key/value rows. Mount with a `key` that changes when the
 * template or the underlying item is reset, so free rows are recomputed.
 */
export function SpecsForm({ template, specs, onChange, onCommitNow }: SpecsFormProps) {
  const templateKeys = specKeysOf(template);
  const [free, setFree] = useState<FreeRow[]>(() =>
    Object.entries(specs)
      .filter(([k]) => !templateKeys.has(k))
      .map(([key, value]) => ({ key, value }))
  );

  const templateValues = (): Record<string, string> =>
    Object.fromEntries(Object.entries(specs).filter(([k]) => templateKeys.has(k)));

  const build = (tpl: Record<string, string>, rows: FreeRow[]) => {
    const out: Record<string, string> = { ...tpl };
    for (const r of rows) {
      const k = r.key.trim();
      if (k && !templateKeys.has(k)) out[k] = r.value;
    }
    return out;
  };

  const setTemplateValue = (key: string, value: string, now = false) => {
    const tpl = templateValues();
    if (value === "") delete tpl[key];
    else tpl[key] = value;
    (now && onCommitNow ? onCommitNow : onChange)(build(tpl, free));
  };

  const updateFree = (rows: FreeRow[], now = false) => {
    setFree(rows);
    (now && onCommitNow ? onCommitNow : onChange)(build(templateValues(), rows));
  };

  return (
    <div className="flex flex-col gap-6">
      {template && template.fields.length > 0 && (
        <TemplateFields
          template={template}
          specs={specs}
          className="sm:grid-cols-2 lg:grid-cols-3"
          onChange={setTemplateValue}
        />
      )}

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 border-b border-cm-hairline pb-2">
          <span className="text-[12px] font-bold uppercase tracking-[1.5px] text-cm-muted">Outras especificações</span>
          <CmButton size="sm" variant="ghost" onClick={() => setFree([...free, { key: "", value: "" }])}>
            <Plus className="h-4 w-4" /> Adicionar
          </CmButton>
        </div>
        {free.length === 0 && <p className="text-[13px] font-light text-cm-muted">Nenhuma. Use para voltagem, cor, material…</p>}
        {free.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <CmInput
              className="w-40 shrink-0"
              placeholder="Nome"
              aria-label="Nome da especificação"
              value={r.key}
              onChange={(e) => updateFree(free.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
            />
            <CmInput
              className="min-w-0 flex-1"
              placeholder="Valor"
              aria-label="Valor da especificação"
              value={r.value}
              onChange={(e) => updateFree(free.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
            />
            <CmIconButton
              size="sm"
              className="border-transparent bg-transparent"
              aria-label="Remover especificação"
              onClick={() => updateFree(free.filter((_, j) => j !== i), true)}
            >
              <Trash2 className="h-4 w-4" />
            </CmIconButton>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Just the fields of the template (no free rows). Used by the add dialog and, through SpecsForm, by the detail. */
export function TemplateFields({
  template,
  specs,
  onChange,
  className,
  idPrefix = "spec",
}: {
  template: CategoryTemplate;
  specs: Record<string, string>;
  /** `now` = a select or toggle (commit at once); text and number fields are debounced by the caller. */
  onChange: (key: string, value: string, now?: boolean) => void;
  className?: string;
  idPrefix?: string;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-4", className)}>
      {template.fields.map((f) => (
        <SpecInput
          key={f.key}
          field={f}
          idPrefix={idPrefix}
          value={specs[f.key] ?? ""}
          onChange={(v) => onChange(f.key, v)}
          onCommit={(v) => onChange(f.key, v, true)}
        />
      ))}
    </div>
  );
}

function SpecInput({
  field,
  value,
  onChange,
  onCommit,
  idPrefix,
}: {
  field: SpecField;
  value: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
  idPrefix: string;
}) {
  const label = field.unit ? `${field.label} (${field.unit})` : field.label;
  const id = `${idPrefix}-${field.key}`;
  switch (field.kind) {
    case "bool":
      return (
        <CmField label={label}>
          <div className="flex h-12 items-center">
            <CmCheckbox checked={value === "true"} onChange={(v) => onCommit(v ? "true" : "false")}>
              {value === "true" ? "Sim" : value === "false" ? "Não" : "Não informado"}
            </CmCheckbox>
          </div>
        </CmField>
      );
    case "enum":
      return (
        <CmField label={label} htmlFor={id}>
          <CmSelect id={id} value={value} onChange={(e) => onCommit(e.target.value)}>
            <option value="">—</option>
            {(field.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
            {value !== "" && !(field.options ?? []).includes(value) && <option value={value}>{value}</option>}
          </CmSelect>
        </CmField>
      );
    case "number":
      return (
        <CmField label={label} htmlFor={id}>
          <CmInput id={id} type="number" value={value} onChange={(e) => onChange(e.target.value)} />
        </CmField>
      );
    default:
      return (
        <CmField label={label} htmlFor={id}>
          <CmInput id={id} value={value} onChange={(e) => onChange(e.target.value)} />
        </CmField>
      );
  }
}
