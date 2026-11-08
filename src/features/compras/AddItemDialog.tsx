import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardPaste, Loader2, PenLine } from "lucide-react";
import { comprasPreviewUrl, comprasSetAlert, comprasUpsertItem } from "@/api";
import { useToast } from "@/hooks/use-toast";
import type { CategoryTemplate, Extracted, ItemView } from "@/types";
import { clipboardLink, defaultAlertCents, hostLabel } from "./addCalc";
import { emptyRule } from "./alertCalc";
import { uniqueCategories } from "./calc";
import { errorMessage } from "./format";
import { blankItem, createOfferFromDraft } from "./offerActions";
import { draftIsValid, EMPTY_MANUAL, ManualOfferFields, UrlPreviewCard, type ManualDraft, type OfferDraft } from "./OfferSourceForm";
import { PriorityChips } from "./PriorityChips";
import { PRIORITY_DEFAULT } from "./rooms";
import { RoomInput } from "./RoomInput";
import { TemplateFields } from "./SpecsForm";
import { specKeysOf, suggestCategoryForTemplate, suggestTemplate, PC_CATEGORY } from "./templates";
import { parseQuickAdd } from "./todayCalc";
import {
  CmBrlInput,
  CmButton,
  CmChip,
  CmDialog,
  CmDialogContent,
  CmDialogDescription,
  CmDialogFooter,
  CmDialogTitle,
  CmField,
  CmInput,
  CmSelect,
} from "./ui";

const PREVIEW_DELAY_MS = 350;
const CLIPBOARD_TIMEOUT_MS = 800;

type Preview =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; extracted: Extracted }
  | { status: "error"; message: string };

interface AddItemDialogProps {
  open: boolean;
  items: ItemView[];
  templates: CategoryTemplate[];
  /** Room suggestions (settings list + rooms in use). */
  rooms: string[];
  /** Pre-selected category (e.g. the active filter). */
  defaultCategory?: string;
  /** "Avisar quando" starts this many percent below the price found (Configurações). */
  defaultTargetPct?: number;
  /** Starting point from the quick-add field on Hoje: a link starts the preview, a name fills the field. */
  prefill?: { name?: string; url?: string } | null;
  onClose: () => void;
  onCreated: (itemId: string) => void;
}

/** Reads the clipboard without ever blocking: webviews may refuse or never answer. */
async function readClipboardLink(): Promise<string | null> {
  try {
    const read = navigator.clipboard?.readText?.();
    if (!read) return null;
    const text = await Promise.race<string | null>([read, new Promise<null>((r) => setTimeout(() => r(null), CLIPBOARD_TIMEOUT_MS))]);
    return clipboardLink(text);
  } catch {
    return null;
  }
}

/** "+ ADICIONAR": one field (link or name), automatic preview, one compact form. */
export function AddItemDialog({
  open,
  items,
  templates,
  rooms,
  defaultCategory,
  defaultTargetPct,
  prefill,
  onClose,
  onCreated,
}: AddItemDialogProps) {
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [clip, setClip] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview>({ status: "idle" });
  const [retry, setRetry] = useState(0);
  const [manual, setManual] = useState<ManualDraft | null>(null);
  // null/undefined = "not edited yet": the value follows the suggestion until the user types
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const [categoryEdit, setCategoryEdit] = useState<string | null>(null);
  const [templateEdit, setTemplateEdit] = useState<string | null | undefined>(undefined);
  const [alertEdit, setAlertEdit] = useState<number | null | undefined>(undefined);
  const [specs, setSpecs] = useState<Record<string, string>>({});
  const [room, setRoom] = useState<string | null>(null);
  const [priority, setPriority] = useState<number>(PRIORITY_DEFAULT);
  const [qty, setQty] = useState("1");
  const [budget, setBudget] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const reqId = useRef(0);

  // every time the dialog opens: clean slate, starting from the quick-add text if there is one
  useEffect(() => {
    if (!open) return;
    setInput(prefill?.url ?? prefill?.name ?? "");
    setClip(null);
    setPreview({ status: "idle" });
    setManual(null);
    setNameEdit(null);
    setCategoryEdit(null);
    setTemplateEdit(undefined);
    setAlertEdit(undefined);
    setSpecs({});
    setRoom(null);
    setPriority(PRIORITY_DEFAULT);
    setQty("1");
    setBudget(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill]);

  // a link on the clipboard becomes a one-click suggestion (skipped silently when the webview says no)
  useEffect(() => {
    if (!open || prefill?.url || prefill?.name) return;
    let alive = true;
    void readClipboardLink().then((l) => alive && setClip(l));
    return () => {
      alive = false;
    };
  }, [open, prefill]);

  const parsed = useMemo(() => parseQuickAdd(input), [input]);
  const url = parsed.url;

  // link typed or pasted: preview it on its own (debounced; stale answers are dropped)
  useEffect(() => {
    if (!open) return;
    const id = ++reqId.current;
    if (!url) {
      setPreview({ status: "idle" });
      return;
    }
    setPreview({ status: "loading" });
    const timer = setTimeout(() => {
      comprasPreviewUrl(url).then(
        (extracted) => id === reqId.current && setPreview({ status: "ok", extracted }),
        (e) => id === reqId.current && setPreview({ status: "error", message: errorMessage(e) })
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      clearTimeout(timer);
      reqId.current++;
    };
  }, [open, url, retry]);

  const extracted = preview.status === "ok" ? preview.extracted : null;
  const draft: OfferDraft | null = manual ?? (extracted ? { kind: "url", extracted } : null);
  const offerValid = draftIsValid(draft);

  const name = nameEdit ?? (url ? (extracted?.title ?? "").trim().slice(0, 120) : (parsed.name ?? ""));
  const templateId = templateEdit !== undefined ? templateEdit : (suggestTemplate(name, templates)?.id ?? null);
  const template = templates.find((t) => t.id === templateId) ?? null;
  const category = categoryEdit ?? suggestCategoryForTemplate(templateId) ?? defaultCategory ?? "";

  const price = draft && offerValid ? (draft.kind === "url" ? (draft.extracted.cashCents ?? draft.extracted.listCents) : (draft.cashCents ?? draft.listCents)) : null;
  const alertCents = alertEdit !== undefined ? alertEdit : defaultAlertCents(price, defaultTargetPct);

  const categories = useMemo(() => {
    const list = uniqueCategories(items);
    return list.some((c) => c.toLowerCase() === PC_CATEGORY.toLowerCase()) ? list : [...list, PC_CATEGORY];
  }, [items]);

  const qtyNum = Math.max(0, Math.floor(Number(qty) || 0));
  const checkingLink = url != null && manual == null && preview.status === "loading";
  const missing = name.trim() === "" ? "Falta o nome." : category.trim() === "" ? "Falta a categoria." : null;
  const canAdd = !busy && !checkingLink && missing == null;

  const openManual = () => {
    setManual({ ...EMPTY_MANUAL, store: extracted?.store ?? "", url: extracted?.url ?? url ?? "" });
  };

  const create = async () => {
    setBusy(true);
    try {
      const keys = specKeysOf(template);
      const cleanSpecs = Object.fromEntries(Object.entries(specs).filter(([k, v]) => keys.has(k) && v.trim() !== ""));
      const created = await comprasUpsertItem(
        blankItem({
          name: name.trim(),
          category: category.trim(),
          room: room?.trim() ? room.trim() : null,
          priority,
          qty: qtyNum,
          budgetUnitCents: budget,
          templateId,
          specs: cleanSpecs,
        })
      );
      let warning: string | undefined;
      if (alertCents != null && alertCents > 0) {
        try {
          await comprasSetAlert({ ...emptyRule(created.id), enabled: true, targetCents: alertCents });
        } catch (e) {
          warning = `Item criado, mas o aviso falhou: ${errorMessage(e)}`;
        }
      }
      if (draft && offerValid) {
        try {
          warning = (await createOfferFromDraft(created.id, draft, { saveImage: true })).warning ?? warning;
        } catch (e) {
          warning = `Item criado, mas a oferta falhou: ${errorMessage(e)}`;
        }
      }
      toast({
        variant: warning ? "warning" : "success",
        title: warning ? "Item criado com avisos" : "Item criado",
        description: warning ?? created.name,
      });
      onCreated(created.id);
      onClose();
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível criar o item", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const setSpec = (key: string, value: string) => setSpecs((s) => ({ ...s, [key]: value }));

  return (
    <CmDialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <CmDialogContent className="max-w-2xl" aria-describedby="add-item-desc">
        <div className="flex flex-col gap-1 pr-8">
          <CmDialogTitle>Adicionar item</CmDialogTitle>
          <CmDialogDescription id="add-item-desc">
            Cole o link de uma loja ou digite o nome. Com o link, buscamos foto, nome e preço sozinhos.
          </CmDialogDescription>
        </div>

        <div className="flex flex-col gap-3">
          <CmField label="Cole um link ou digite um nome" htmlFor="add-input">
            <CmInput
              id="add-input"
              className="h-16 text-[16px]"
              value={input}
              autoFocus
              autoComplete="off"
              placeholder="https://… ou Placa de vídeo RTX 4060"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && url) setRetry((n) => n + 1);
              }}
            />
          </CmField>
          {clip && input.trim() === "" && (
            <CmButton className="w-fit max-w-full" onClick={() => setInput(clip)}>
              <ClipboardPaste aria-hidden className="h-4 w-4" />
              <span className="truncate">Usar link copiado: {hostLabel(clip)}</span>
            </CmButton>
          )}
        </div>

        {url && !manual && (
          <div className="flex flex-col gap-3" aria-live="polite">
            {preview.status === "loading" && (
              <p className="flex items-center gap-2 text-[14px] font-light text-cm-body">
                <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Buscando o produto…
              </p>
            )}
            {preview.status === "error" && (
              <div role="alert" className="flex flex-col gap-3 border border-cm-danger p-3 text-[13px] font-light text-cm-danger">
                <span>Não deu para ler este link: {preview.message}. Sem uma oferta, o item entra só com o nome.</span>
                <div className="flex flex-wrap gap-3">
                  <CmButton size="sm" onClick={() => setRetry((n) => n + 1)}>
                    Tentar de novo
                  </CmButton>
                  <CmButton size="sm" variant="ghost" onClick={openManual}>
                    Digitar preço
                  </CmButton>
                </div>
              </div>
            )}
            {extracted && <UrlPreviewCard extracted={extracted} onUseManual={openManual} />}
          </div>
        )}

        {manual ? (
          <div className="flex flex-col gap-3 border border-cm-hairline p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] font-bold uppercase tracking-[1.5px] text-cm-ink">Preço digitado</span>
              <CmButton size="sm" variant="ghost" onClick={() => setManual(null)}>
                {url ? "Voltar ao link" : "Sem preço agora"}
              </CmButton>
            </div>
            <ManualOfferFields value={manual} onChange={setManual} />
          </div>
        ) : (
          <button
            type="button"
            onClick={openManual}
            className="inline-flex w-fit items-center gap-2 text-[13px] font-light text-cm-muted underline-offset-2 hover:text-cm-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cm-ink"
          >
            <PenLine aria-hidden className="h-4 w-4" /> Loja não deixa consultar? Digitar preço
          </button>
        )}

        <div className="grid grid-cols-6 gap-4 border-t border-cm-hairline pt-5">
          <CmField label="Nome" htmlFor="add-name" className="col-span-6">
            <CmInput
              id="add-name"
              value={name}
              placeholder="Como você quer chamar este item"
              onChange={(e) => setNameEdit(e.target.value)}
            />
          </CmField>

          <CmField label="Categoria" htmlFor="add-category" className="col-span-6">
            <CmInput
              id="add-category"
              value={category}
              placeholder="Escolha ou digite uma nova"
              onChange={(e) => setCategoryEdit(e.target.value)}
            />
            <div className="mt-1 flex flex-wrap gap-2">
              {categories.map((c) => (
                <CmChip key={c} selected={category === c} className="h-8 px-2.5" onClick={() => setCategoryEdit(c)}>
                  {c}
                </CmChip>
              ))}
            </div>
          </CmField>

          <CmField label="Cômodo" htmlFor="add-room" className="col-span-6 sm:col-span-3">
            <RoomInput id="add-room" value={room} options={rooms} onChange={setRoom} />
          </CmField>
          <CmField label="Quantidade" htmlFor="add-qty" className="col-span-2 sm:col-span-1">
            <CmInput id="add-qty" type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} />
          </CmField>
          <CmField label="Orçado (un.)" htmlFor="add-budget" className="col-span-4 sm:col-span-2">
            <CmBrlInput id="add-budget" value={budget} onChange={setBudget} />
          </CmField>

          <div className="col-span-6 flex flex-col gap-2">
            <span className="text-[12px] font-bold uppercase tracking-[1.5px] text-cm-muted">
              Prioridade
            </span>
            <PriorityChips value={priority} onChange={setPriority} />
          </div>

          <CmField label="Modelo de especificações" htmlFor="add-template" className="col-span-6" hint="Sugerido pelo nome; você pode trocar.">
            <CmSelect
              id="add-template"
              value={templateId ?? ""}
              onChange={(e) => {
                setTemplateEdit(e.target.value === "" ? null : e.target.value);
                setSpecs({});
              }}
            >
              <option value="">Nenhum</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </CmSelect>
          </CmField>
          {template && template.fields.length > 0 && (
            <div className="col-span-6">
              <TemplateFields
                template={template}
                specs={specs}
                idPrefix="add-spec"
                className="sm:grid-cols-2"
                onChange={(k, v) => setSpec(k, v)}
              />
            </div>
          )}

          <CmField
            label="Avisar quando custar até"
            htmlFor="add-alert"
            className="col-span-6"
            hint={
              price != null && defaultAlertCents(price, defaultTargetPct) != null
                ? `Sugerido: ${Math.round(defaultTargetPct ?? 10)}% abaixo do preço encontrado. Apague para não avisar.`
                : "Opcional. Avisamos quando o preço final (com frete) chegar nesse valor."
            }
          >
            <CmBrlInput id="add-alert" value={alertCents} onChange={setAlertEdit} />
          </CmField>
        </div>

        <CmDialogFooter>
          {missing && <span className="mr-auto text-[13px] font-light text-cm-muted">{missing}</span>}
          <CmButton variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </CmButton>
          <CmButton variant="strong" onClick={create} disabled={!canAdd}>
            {busy ? "Adicionando…" : checkingLink ? "Buscando…" : "Adicionar"}
          </CmButton>
        </CmDialogFooter>
      </CmDialogContent>
    </CmDialog>
  );
}
