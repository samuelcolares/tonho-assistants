import { Camera } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ComprasItem, ItemView } from "@/types";
import { BrlInput } from "./BrlInput";
import { Field, ItemThumb } from "./shared";

interface ItemFormProps {
  view: ItemView;
  draft: ComprasItem;
  categories: string[];
  onChange: (patch: Partial<ComprasItem>) => void;
  onPickImage: () => void;
}

/** Editable core fields of an item (image, name, category, qty, budget, target, model, priority, notes). */
export function ItemForm({ view, draft, categories, onChange, onPickImage }: ItemFormProps) {
  return (
    <div className="flex gap-5">
      <button
        type="button"
        onClick={onPickImage}
        title="Trocar imagem"
        className="group relative h-32 w-32 shrink-0 self-start overflow-hidden rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <ItemThumb view={view} size={128} className="rounded-lg" />
        <span className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/55 text-[12px] font-semibold text-ink opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Camera className="h-4 w-4" /> Trocar
        </span>
      </button>

      <div className="grid min-w-0 flex-1 grid-cols-6 gap-3">
        <Field label="Nome" className="col-span-6">
          <Input value={draft.name} onChange={(e) => onChange({ name: e.target.value })} />
        </Field>
        <Field label="Categoria" className="col-span-3">
          <Input list="compras-categories" value={draft.category} onChange={(e) => onChange({ category: e.target.value })} />
          <datalist id="compras-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Qtd." className="col-span-1">
          <Input
            type="number"
            min={0}
            value={draft.qty}
            onChange={(e) => onChange({ qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
          />
        </Field>
        <Field label="Modelo (variante)" className="col-span-2" hint="Se o título da loja não tiver isso, a oferta fica suspeita.">
          <Input
            value={draft.modelToken ?? ""}
            onChange={(e) => onChange({ modelToken: e.target.value.trim() === "" ? null : e.target.value })}
            placeholder="Ex.: AR12TVSBAWKNAZ"
          />
        </Field>
        <Field label="Orçado (un.)" className="col-span-2">
          <BrlInput value={draft.budgetUnitCents} onChange={(c) => onChange({ budgetUnitCents: c })} />
        </Field>
        <Field label="Avisar em (preço final un.)" className="col-span-2">
          <BrlInput value={draft.targetCents} onChange={(c) => onChange({ targetCents: c })} />
        </Field>
        <Field label="Prioridade" className="col-span-2">
          <label className="flex h-9 items-center gap-2 text-[13px] text-ink-muted">
            <Switch checked={draft.priority > 0} onCheckedChange={(v) => onChange({ priority: v ? 1 : 0 })} />
            {draft.priority > 0 ? "Alta" : "Normal"}
          </label>
        </Field>
        <Field label="Observações" className="col-span-6">
          <Textarea rows={2} value={draft.notes} onChange={(e) => onChange({ notes: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}
