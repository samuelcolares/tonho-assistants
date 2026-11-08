import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { comprasSetAlert, comprasUpsertItem } from "@/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { CategoryTemplate, ItemView } from "@/types";
import { emptyRule } from "./alertCalc";
import { uniqueCategories } from "./calc";
import { errorMessage } from "./format";
import { blankItem, createOfferFromDraft } from "./offerActions";
import { draftIsValid, OfferSourceForm, type OfferDraft } from "./OfferSourceForm";
import { suggestTemplate } from "./templates";
import {
  CmBrlInput,
  CmButton,
  CmChip,
  CmDialog,
  CmDialogContent,
  CmDialogDescription,
  CmDialogFooter,
  CmDialogTitle,
  CmInput,
  CmLabel,
} from "./ui";

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

function CmField({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <CmLabel>{label}</CmLabel>
      {children}
      {hint && <p className="text-[12px] font-light text-cm-muted">{hint}</p>}
    </div>
  );
}

export function AddItemDialog({ open, items, templates, defaultCategory, onClose, onCreated }: AddItemDialogProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [qty, setQty] = useState("1");
  const [budget, setBudget] = useState<number | null>(null);
  const [alertCents, setAlertCents] = useState<number | null>(null);
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
    setAlertCents(null);
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
      if (alertCents != null && alertCents > 0) {
        try {
          await comprasSetAlert({ ...emptyRule(created.id), enabled: true, targetCents: alertCents });
        } catch (e) {
          warning = `Item criado, mas o aviso falhou: ${errorMessage(e)}`;
        }
      }
      if (withOffer && draft && draftIsValid(draft)) {
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

  return (
    <CmDialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <CmDialogContent aria-describedby="add-item-desc">
        <div className="flex flex-col gap-1 pr-8">
          <CmDialogTitle>Novo item · passo {step} de 2</CmDialogTitle>
          <CmDialogDescription id="add-item-desc">
            {step === 1 ? "Dados básicos, orçamento e aviso de preço." : "Opcional: cole o link de uma loja para já acompanhar o preço."}
          </CmDialogDescription>
        </div>

        {step === 1 ? (
          <div className="grid grid-cols-6 gap-4">
            <CmField label="Nome" className="col-span-6">
              <CmInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Ar-condicionado 12000 btus inverter"
                autoFocus
              />
            </CmField>
            <CmField label="Categoria" className="col-span-6">
              <CmInput value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Escolha ou digite uma nova" />
              {categories.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-2">
                  {categories.map((c) => (
                    <CmChip key={c} selected={category === c} className="h-8 px-2.5" onClick={() => setCategory(c)}>
                      {c}
                    </CmChip>
                  ))}
                </div>
              )}
            </CmField>
            <CmField label="Quantidade" className="col-span-2">
              <CmInput type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} />
            </CmField>
            <CmField label="Orçado (un.)" className="col-span-4">
              <CmBrlInput value={budget} onChange={setBudget} aria-label="Orçado por unidade" />
            </CmField>
            <CmField
              label="Avisar quando custar até"
              className="col-span-6"
              hint="Opcional. Avisamos quando o preço final (com frete) chegar nesse valor."
            >
              <CmBrlInput value={alertCents} onChange={setAlertCents} aria-label="Avisar quando custar até" />
            </CmField>
            <CmField label="Modelo de especificações" className="col-span-6" hint="Sugerido pelo nome; você pode trocar.">
              <Select
                value={templateId ?? NO_TEMPLATE}
                onValueChange={(v) => {
                  setTemplateTouched(true);
                  setTemplateId(v === NO_TEMPLATE ? null : v);
                }}
              >
                <SelectTrigger className="h-12 rounded-none border-cm-hairline bg-cm-card font-light text-cm-ink">
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
            </CmField>
          </div>
        ) : (
          <OfferSourceForm draft={draft} onChange={setDraft} />
        )}

        <CmDialogFooter>
          {step === 1 ? (
            <>
              <CmButton variant="ghost" onClick={onClose}>
                Cancelar
              </CmButton>
              <CmButton onClick={() => create(false)} disabled={!step1Valid || busy}>
                Criar sem link
              </CmButton>
              <CmButton variant="strong" onClick={() => setStep(2)} disabled={!step1Valid}>
                Próximo <ArrowRight className="h-4 w-4" />
              </CmButton>
            </>
          ) : (
            <>
              <CmButton variant="ghost" onClick={() => setStep(1)} disabled={busy}>
                <ArrowLeft className="h-4 w-4" /> Voltar
              </CmButton>
              <CmButton onClick={() => create(false)} disabled={busy}>
                Criar sem oferta
              </CmButton>
              <CmButton variant="strong" onClick={() => create(true)} disabled={busy || !draftIsValid(draft)}>
                {busy ? "Criando…" : "Criar item e oferta"}
              </CmButton>
            </>
          )}
        </CmDialogFooter>
      </CmDialogContent>
    </CmDialog>
  );
}
