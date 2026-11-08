import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { comprasUpsertItem } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { CategoryTemplate, ItemView } from "@/types";
import { BrlInput } from "./BrlInput";
import { uniqueCategories } from "./calc";
import { errorMessage } from "./format";
import { blankItem, createOfferFromDraft } from "./offerActions";
import { draftIsValid, OfferSourceForm, type OfferDraft } from "./OfferSourceForm";
import { Field } from "./shared";
import { suggestTemplate } from "./templates";

const NO_TEMPLATE = "__none__";

interface AddItemDialogProps {
  open: boolean;
  items: ItemView[];
  templates: CategoryTemplate[];
  /** Pre-selected category (e.g. the active filter). */
  defaultCategory?: string;
  onClose: () => void;
  onCreated: (itemId: string) => void;
}

export function AddItemDialog({ open, items, templates, defaultCategory, onClose, onCreated }: AddItemDialogProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [qty, setQty] = useState("1");
  const [budget, setBudget] = useState<number | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [templateTouched, setTemplateTouched] = useState(false);
  const [draft, setDraft] = useState<OfferDraft | null>(null);
  const [busy, setBusy] = useState(false);

  const categories = useMemo(() => uniqueCategories(items), [items]);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setName("");
    setCategory(defaultCategory ?? "");
    setQty("1");
    setBudget(null);
    setTemplateId(null);
    setTemplateTouched(false);
    setDraft(null);
  }, [open, defaultCategory]);

  useEffect(() => {
    if (templateTouched) return;
    setTemplateId(suggestTemplate(name, templates)?.id ?? null);
  }, [name, templates, templateTouched]);

  const step1Valid = name.trim() !== "" && category.trim() !== "";
  const qtyNum = Math.max(0, Math.floor(Number(qty) || 0));

  const create = async (withOffer: boolean) => {
    setBusy(true);
    try {
      const created = await comprasUpsertItem(
        blankItem({
          name: name.trim(),
          category: category.trim(),
          qty: qtyNum,
          budgetUnitCents: budget,
          templateId,
        })
      );
      let warning: string | undefined;
      if (withOffer && draft && draftIsValid(draft)) {
        try {
          warning = (await createOfferFromDraft(created.id, draft, { saveImage: true })).warning;
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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Novo item · passo {step} de 2</DialogTitle>
          <DialogDescription>
            {step === 1 ? "Dados básicos e orçamento." : "Opcional: cole o link de uma loja para já acompanhar o preço."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="grid grid-cols-6 gap-3">
            <Field label="Nome" className="col-span-6">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Ar-condicionado 12000 btus inverter"
                autoFocus
              />
            </Field>
            <Field label="Categoria" className="col-span-6">
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Escolha ou digite uma nova" />
              {categories.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {categories.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategory(c)}
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium transition-colors",
                        category === c
                          ? "border-compras bg-compras-subtle text-compras"
                          : "border-border text-ink-muted hover:text-ink"
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </Field>
            <Field label="Quantidade" className="col-span-2">
              <Input type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
            <Field label="Orçado (un.)" className="col-span-4">
              <BrlInput value={budget} onChange={setBudget} />
            </Field>
            <Field label="Modelo de especificações" className="col-span-6" hint="Sugerido pelo nome; você pode trocar.">
              <Select
                value={templateId ?? NO_TEMPLATE}
                onValueChange={(v) => {
                  setTemplateTouched(true);
                  setTemplateId(v === NO_TEMPLATE ? null : v);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TEMPLATE}>Nenhum</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        ) : (
          <OfferSourceForm draft={draft} onChange={setDraft} />
        )}

        <DialogFooter className="items-center">
          {step === 1 ? (
            <>
              <Button variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button variant="secondary" onClick={() => create(false)} disabled={!step1Valid || busy}>
                Criar sem link
              </Button>
              <Button onClick={() => setStep(2)} disabled={!step1Valid}>
                Próximo <ArrowRight className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setStep(1)} disabled={busy}>
                <ArrowLeft className="h-4 w-4" /> Voltar
              </Button>
              <Button variant="secondary" onClick={() => create(false)} disabled={busy}>
                Criar sem oferta
              </Button>
              <Button onClick={() => create(true)} disabled={busy || !draftIsValid(draft)}>
                {busy ? "Criando…" : "Criar item e oferta"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
