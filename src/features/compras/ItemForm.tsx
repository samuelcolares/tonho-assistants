import type { ComprasItem } from "@/types";
import { PriorityChips } from "./PriorityChips";
import { RoomInput } from "./RoomInput";
import { CmBrlInput, CmField, CmInput, CmTextarea } from "./ui";

interface ItemFormProps {
  draft: ComprasItem;
  categories: string[];
  /** Room suggestions (settings list + rooms in use). */
  rooms: string[];
  /** Autosave patch: debounced by default, saved at once with `immediate`. */
  onChange: (patch: Partial<ComprasItem>, immediate?: boolean) => void;
}

/**
 * Editable core fields of an item (name, category, room, qty, budget, priority, model code, notes).
 * The price target is NOT edited here: it lives in the alert card ("Mudar valor").
 */
export function ItemForm({ draft, categories, rooms, onChange }: ItemFormProps) {
  return (
    <div className="grid grid-cols-6 gap-x-4 gap-y-5">
      <CmField label="Nome" htmlFor="item-name" className="col-span-6">
        <CmInput id="item-name" value={draft.name} onChange={(e) => onChange({ name: e.target.value })} />
      </CmField>
      <CmField label="Categoria" htmlFor="item-category" className="col-span-3">
        <CmInput id="item-category" list="compras-categories" value={draft.category} onChange={(e) => onChange({ category: e.target.value })} />
        <datalist id="compras-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </CmField>
      <CmField label="Cômodo" htmlFor="item-room" className="col-span-3">
        <RoomInput id="item-room" value={draft.room} options={rooms} onChange={(room) => onChange({ room })} />
      </CmField>
      <CmField label="Qtd." htmlFor="item-qty" className="col-span-1">
        <CmInput
          id="item-qty"
          type="number"
          min={0}
          value={draft.qty}
          onChange={(e) => onChange({ qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
        />
      </CmField>
      <CmField label="Orçado (un.)" htmlFor="item-budget" className="col-span-2">
        <CmBrlInput id="item-budget" value={draft.budgetUnitCents} onChange={(c) => onChange({ budgetUnitCents: c })} />
      </CmField>
      <CmField label="Prioridade" className="col-span-3">
        <PriorityChips value={draft.priority} onChange={(priority) => onChange({ priority }, true)} />
      </CmField>
      <CmField
        label="Código do modelo (para conferir a loja)"
        htmlFor="item-model"
        hint="Se o título da loja não tiver esse código, o preço aparece como “Conferir”."
        className="col-span-6"
      >
        <CmInput
          id="item-model"
          value={draft.modelToken ?? ""}
          onChange={(e) => onChange({ modelToken: e.target.value.trim() === "" ? null : e.target.value })}
          placeholder="Ex.: AR12TVSBAWKNAZ"
        />
      </CmField>
      <CmField label="Observações" htmlFor="item-notes" className="col-span-6">
        <CmTextarea id="item-notes" rows={3} value={draft.notes} onChange={(e) => onChange({ notes: e.target.value })} />
      </CmField>
    </div>
  );
}
