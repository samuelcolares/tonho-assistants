import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Bell, Check, RefreshCw, Save, Trash2, Undo2 } from "lucide-react";
import {
  comprasDeleteItem,
  comprasGetItem,
  comprasRefresh,
  comprasUnmarkBought,
  comprasUpsertItem,
  onComprasUpdated,
} from "@/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { CategoryTemplate, ComprasItem, ItemView } from "@/types";
import { AddOfferDialog } from "./AddOfferDialog";
import { AlertDialog } from "./AlertDialog";
import { errorMessage, formatDateTime } from "./format";
import { ImageDialog } from "./ImageDialog";
import { ItemBadges } from "./ItemBadges";
import { ItemForm } from "./ItemForm";
import { MarkBoughtDialog } from "./MarkBoughtDialog";
import { OffersTable } from "./OffersTable";
import { PriceChart } from "./PriceChart";
import { ConfirmDialog } from "./shared";
import { SpecsForm } from "./SpecsForm";
import { StatsPanel } from "./StatsPanel";
import { CmButton, CmIconButton } from "./ui";
import { formatBRL } from "./money";

const NO_TEMPLATE = "__none__";

interface ItemDetailProps {
  id: string;
  templates: CategoryTemplate[];
  categories: string[];
  onBack: () => void;
  /** Called after any change so the list/dashboard can refresh. */
  onChanged: () => void;
}

function SectionCard({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {aside}
      </div>
      {children}
    </Card>
  );
}

export function ItemDetail({ id, templates, categories, onBack, onChanged }: ItemDetailProps) {
  const { toast } = useToast();
  const [view, setView] = useState<ItemView | null>(null);
  const [draft, setDraft] = useState<ComprasItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [imageOpen, setImageOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [boughtOpen, setBoughtOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const baseline = useRef<string>("");
  const draftRef = useRef<ComprasItem | null>(null);
  draftRef.current = draft;

  const load = useCallback(async () => {
    try {
      const v = await comprasGetItem(id);
      setView(v);
      const incoming = JSON.stringify(v.item);
      const current = draftRef.current;
      // Replace the draft only if the user has no unsaved edits.
      if (!current || JSON.stringify(current) === baseline.current) {
        setDraft(v.item);
        setResetKey((k) => k + 1);
      }
      baseline.current = incoming;
    } catch (e) {
      toast({ variant: "danger", title: "Item não encontrado", description: errorMessage(e) });
      onBack();
    }
  }, [id, onBack, toast]);

  useEffect(() => {
    load();
    const un = onComprasUpdated((itemId) => {
      if (itemId == null || itemId === id) load();
    });
    return () => {
      un.then((fn) => fn()).catch(() => {});
    };
  }, [id, load]);

  const changed = useCallback(async () => {
    await load();
    onChanged();
  }, [load, onChanged]);

  if (!view || !draft) return <p className="py-12 text-center text-sm text-ink-muted">Carregando item…</p>;

  const dirty = JSON.stringify(draft) !== baseline.current;
  const template = templates.find((t) => t.id === draft.templateId) ?? null;
  const patch = (p: Partial<ComprasItem>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const save = async () => {
    if (!draft.name.trim() || !draft.category.trim()) {
      toast({ variant: "warning", title: "Nome e categoria são obrigatórios" });
      return;
    }
    setSaving(true);
    try {
      await comprasUpsertItem({ ...draft, name: draft.name.trim(), category: draft.category.trim() });
      toast({ variant: "success", title: "Item salvo" });
      baseline.current = JSON.stringify(draft);
      await changed();
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível salvar", description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setDraft(view.item);
    baseline.current = JSON.stringify(view.item);
    setResetKey((k) => k + 1);
  };

  const refresh = async () => {
    try {
      await comprasRefresh(id, null);
      toast({ title: "Atualização pedida", description: "Os preços aparecem em instantes." });
    } catch (e) {
      toast({ variant: "danger", title: "Falha ao atualizar", description: errorMessage(e) });
    }
  };

  const unmark = async () => {
    try {
      await comprasUnmarkBought(id);
      toast({ title: "Compra desfeita" });
      await changed();
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível desfazer", description: errorMessage(e) });
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await comprasDeleteItem(id);
      toast({ title: "Item excluído", description: view.item.name });
      onChanged();
      onBack();
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível excluir", description: errorMessage(e) });
      setDeleting(false);
    }
  };

  const chartKey = `${view.item.updatedAt}|${view.offers.map((o) => `${o.id}:${o.latest?.lastSeenAt ?? ""}`).join(",")}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <CmButton variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Voltar
        </CmButton>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <h2 className="truncate text-[20px] font-bold uppercase text-cm-ink">{view.item.name}</h2>
          <ItemBadges view={view} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CmIconButton
            active={view.alert?.enabled === true && !view.item.bought}
            disabled={view.item.bought}
            aria-label={view.alert?.enabled ? "Editar aviso de preço" : "Avisar quando baixar"}
            title={view.item.bought ? "Item já comprado" : view.alert?.enabled ? "Aviso ligado" : "Avisar quando baixar"}
            onClick={() => setAlertOpen(true)}
          >
            <Bell className="h-4 w-4" />
          </CmIconButton>
          <CmButton size="sm" onClick={refresh}>
            <RefreshCw className="h-4 w-4" /> Atualizar agora
          </CmButton>
          {view.item.bought ? (
            <CmButton size="sm" onClick={unmark}>
              <Undo2 className="h-4 w-4" /> Desfazer compra
            </CmButton>
          ) : (
            <CmButton variant="strong" size="sm" onClick={() => setBoughtOpen(true)}>
              <Check className="h-4 w-4" /> Marcar comprado
            </CmButton>
          )}
          <CmButton variant="danger-ghost" size="sm" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" /> Excluir
          </CmButton>
        </div>
      </div>

      {dirty && (
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning-subtle px-4 py-2.5">
          <span className="text-[13px] font-medium text-warning">Alterações não salvas</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={discard} disabled={saving}>
              Descartar
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              <Save className="h-4 w-4" /> {saving ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </div>
      )}

      {view.purchase && (
        <div className="rounded-md border border-success/40 bg-success-subtle px-4 py-2.5 text-[13px] text-success">
          Comprado em {formatDateTime(view.purchase.purchasedAt)}
          {view.purchase.store ? ` na ${view.purchase.store}` : ""} por{" "}
          <strong className="tabular-nums">{formatBRL(view.purchase.paidUnitCents)}</strong>
          {view.purchase.shippingCents > 0 && ` + ${formatBRL(view.purchase.shippingCents)} de frete`}.
          {view.purchase.notes && <span className="text-ink-muted"> {view.purchase.notes}</span>}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <SectionCard title="Dados do item">
            <ItemForm view={view} draft={draft} categories={categories} onChange={patch} onPickImage={() => setImageOpen(true)} />
          </SectionCard>
        </div>
        <StatsPanel view={view} />
      </div>

      <SectionCard title="Ofertas">
        <OffersTable offers={view.offers} bestId={view.best?.id ?? null} onAdd={() => setOfferOpen(true)} onChanged={changed} />
      </SectionCard>

      <SectionCard title="Histórico de preços">
        <PriceChart itemId={id} offers={view.offers} targetCents={view.item.targetCents} refreshKey={chartKey} />
      </SectionCard>

      <SectionCard
        title="Especificações"
        aside={
          <div className="w-52">
            <Select
              value={draft.templateId ?? NO_TEMPLATE}
              onValueChange={(v) => patch({ templateId: v === NO_TEMPLATE ? null : v })}
            >
              <SelectTrigger aria-label="Modelo de especificações">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TEMPLATE}>Sem modelo</SelectItem>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      >
        <SpecsForm
          key={`${resetKey}:${draft.templateId ?? ""}`}
          template={template}
          specs={draft.specs}
          onChange={(specs) => patch({ specs })}
        />
      </SectionCard>

      <ImageDialog open={imageOpen} itemId={id} onClose={() => setImageOpen(false)} onDone={changed} />
      <AddOfferDialog open={offerOpen} itemId={id} itemName={view.item.name} onClose={() => setOfferOpen(false)} onDone={changed} />
      <MarkBoughtDialog view={boughtOpen ? view : null} onClose={() => setBoughtOpen(false)} onDone={changed} />
      <AlertDialog view={alertOpen ? view : null} onClose={() => setAlertOpen(false)} onDone={changed} />
      <ConfirmDialog
        open={deleteOpen}
        title="Excluir item?"
        description={`"${view.item.name}" será apagado junto com ofertas, histórico de preços, compra e imagem. Isso não pode ser desfeito.`}
        confirmLabel="Excluir item"
        busy={deleting}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={remove}
      />
    </div>
  );
}
