import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { comprasListItems, comprasUpsertItem } from "@/api";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "./format";
import { DEFAULT_ROOMS } from "./rooms";
import { CmButton, CmInput } from "./ui";

const same = (a: string, b: string) => a.trim().toLocaleLowerCase("pt-BR") === b.trim().toLocaleLowerCase("pt-BR");

interface RoomsSectionProps {
  rooms: string[];
  onChange: (rooms: string[]) => void;
  /** Called after items were renamed so lists elsewhere refresh. */
  onItemsChanged: () => void;
}

/** Editable list of rooms. Renaming also moves the items that use the old name. */
export function RoomsSection({ rooms, onChange, onItemsChanged }: RoomsSectionProps) {
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const add = () => {
    const name = draft.trim();
    if (!name) return;
    if (!rooms.some((r) => same(r, name))) onChange([...rooms, name]);
    setDraft("");
  };

  const rename = async (oldName: string) => {
    const name = editText.trim();
    setEditing(null);
    if (!name || name === oldName) return;
    if (rooms.some((r) => !same(r, oldName) && same(r, name))) {
      toast({ variant: "warning", title: "Esse cômodo já existe", description: name });
      return;
    }
    onChange(rooms.map((r) => (r === oldName ? name : r)));
    try {
      const all = await comprasListItems(true);
      const mine = all.filter((v) => v.item.room && same(v.item.room, oldName));
      for (const v of mine) await comprasUpsertItem({ ...v.item, room: name });
      if (mine.length > 0) {
        toast({
          title: "Cômodo renomeado",
          description: `${mine.length} ${mine.length === 1 ? "item mudou" : "itens mudaram"} para "${name}".`,
        });
        onItemsChanged();
      }
    } catch (e) {
      toast({ variant: "danger", title: "O nome mudou, mas nem todos os itens foram atualizados", description: errorMessage(e) });
    }
  };

  return (
    <div className="flex flex-col gap-4 border-t border-cm-hairline pt-4">
      {rooms.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] font-light text-cm-muted">
            Você ainda não montou a sua lista. Enquanto isso, estas sugestões aparecem ao escolher o cômodo de um item:
          </p>
          <div className="flex flex-wrap gap-2">
            {DEFAULT_ROOMS.map((r) => (
              <span
                key={r}
                className="inline-flex h-9 items-center border border-dashed border-cm-hairline px-3 text-[12px] font-bold uppercase tracking-[1px] text-cm-muted"
              >
                {r}
              </span>
            ))}
          </div>
          <CmButton size="sm" className="w-fit" onClick={() => onChange([...DEFAULT_ROOMS])}>
            Usar sugestões
          </CmButton>
        </div>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label="Seus cômodos">
          {rooms.map((r) =>
            editing === r ? (
              <li key={r} className="flex items-center gap-1">
                <CmInput
                  autoFocus
                  aria-label={`Novo nome para ${r}`}
                  className="h-9 w-44 text-[13px]"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void rename(r);
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
                <button
                  type="button"
                  aria-label="Confirmar nome"
                  onClick={() => void rename(r)}
                  className="flex h-9 w-9 items-center justify-center text-cm-accent hover:text-cm-ink"
                >
                  <Check className="h-4 w-4" />
                </button>
              </li>
            ) : (
              <li key={r} className="inline-flex h-9 items-stretch border border-cm-hairline bg-cm-card">
                <span className="flex items-center px-3 text-[12px] font-bold uppercase tracking-[1px] text-cm-body-strong">{r}</span>
                <button
                  type="button"
                  aria-label={`Renomear ${r}`}
                  onClick={() => {
                    setEditing(r);
                    setEditText(r);
                  }}
                  className="flex w-8 items-center justify-center text-cm-muted hover:text-cm-ink"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Remover ${r}`}
                  onClick={() => onChange(rooms.filter((x) => x !== r))}
                  className="flex w-8 items-center justify-center text-cm-muted hover:text-cm-danger"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            )
          )}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <CmInput
          aria-label="Novo cômodo"
          className="w-64"
          placeholder="Ex.: Lavanderia"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <CmButton onClick={add} disabled={!draft.trim()}>
          Adicionar
        </CmButton>
      </div>
      {rooms.length > 0 && (
        <p className="text-[12px] font-light text-cm-muted">
          Remover um cômodo da lista não mexe nos itens: quem já usa esse nome continua nele.
        </p>
      )}
    </div>
  );
}
