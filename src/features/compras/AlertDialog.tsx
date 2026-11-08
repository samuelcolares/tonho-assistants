import { useEffect, useMemo, useState } from "react";
import { comprasHistory, comprasSetAlert } from "@/api";
import { useToast } from "@/hooks/use-toast";
import type { HistoryPoint, ItemView } from "@/types";
import { currentPriceOf, daysAtOrBelow, emptyRule, lowestOf, prefillTarget, targetChips } from "./alertCalc";
import { errorMessage } from "./format";
import { formatBRL } from "./money";
import { ItemThumb } from "./shared";
import {
  CmBrlInput,
  CmButton,
  CmChip,
  CmDialog,
  CmDialogContent,
  CmDialogDescription,
  CmDialogFooter,
  CmDialogTitle,
  CmLabel,
} from "./ui";

interface AlertDialogProps {
  /** Item to configure; null keeps the dialog closed. */
  view: ItemView | null;
  onClose: () => void;
  /** Called after the rule was saved/removed so lists can reload. */
  onDone: () => void;
}

/** "Avisar quando baixar": sets the target price (and the new-low option) of an item. */
export function AlertDialog({ view, onClose, onDone }: AlertDialogProps) {
  const { toast } = useToast();
  const [history, setHistory] = useState<HistoryPoint[] | null>(null);
  const [cents, setCents] = useState<number | null>(null);
  const [newLow, setNewLow] = useState(true);
  const [busy, setBusy] = useState(false);
  const itemId = view?.item.id ?? null;

  // History (90 days) feeds the chips, the prefill and the hint. Loaded each time the dialog opens.
  useEffect(() => {
    if (!itemId) return;
    let alive = true;
    setHistory(null);
    comprasHistory(itemId, 90)
      .then((h) => alive && setHistory(h))
      .catch(() => alive && setHistory([]));
    return () => {
      alive = false;
    };
  }, [itemId]);

  const low90 = useMemo(() => (history ? lowestOf(history) : null), [history]);

  // Initial values once the history is known (an existing target wins over the suggestion).
  const ready = history != null;
  useEffect(() => {
    if (!view || !ready) return;
    const existing = view.alert?.enabled ? view.alert.targetCents : null;
    setCents(existing ?? prefillTarget(view, low90));
    setNewLow(view.alert ? view.alert.notifyNewLow : true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, ready]);

  if (!view) return null;

  const current = currentPriceOf(view);
  const best = view.best;
  const chips = targetChips(view, low90);
  const hasRule = view.alert?.enabled === true;
  const valid = cents != null && cents > 0;
  const alreadyThere = valid && current != null && current <= cents;
  const daysHit = valid && history ? daysAtOrBelow(history, cents) : 0;

  const save = async (enabled: boolean) => {
    setBusy(true);
    try {
      const base = view.alert ?? emptyRule(view.item.id);
      await comprasSetAlert({
        ...base,
        itemId: view.item.id,
        enabled,
        targetCents: enabled ? cents : null,
        notifyNewLow: newLow,
      });
      toast(
        enabled
          ? { variant: "success", title: "Aviso ligado", description: `${view.item.name} · até ${formatBRL(cents)}` }
          : { title: "Aviso removido", description: view.item.name }
      );
      onDone();
      onClose();
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível salvar o aviso", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <CmDialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <CmDialogContent aria-describedby="alert-dialog-desc">
        <div className="flex items-start gap-4 pr-8">
          <ItemThumb view={view} size={56} className="rounded-none border-cm-hairline bg-cm-card" />
          <div className="flex min-w-0 flex-col gap-1">
            <CmDialogTitle>Avisar quando baixar</CmDialogTitle>
            <CmDialogDescription id="alert-dialog-desc" className="truncate">
              {view.item.name}
              {best && best.finalCents != null
                ? ` · hoje ${formatBRL(best.finalCents)} na ${best.store}`
                : " · ainda sem preço"}
            </CmDialogDescription>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <CmLabel htmlFor="alert-target">Preço desejado (já com frete)</CmLabel>
          <CmBrlInput id="alert-target" size="lg" value={cents} onChange={setCents} autoFocus aria-label="Preço desejado" />
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Sugestões de preço">
          {chips.map((c) => (
            <CmChip
              key={c.key}
              disabled={c.cents == null}
              selected={c.cents != null && c.cents === cents}
              onClick={() => c.cents != null && setCents(c.cents)}
              title={c.cents == null ? "Ainda sem dados para esta sugestão" : undefined}
            >
              {c.label}
              {c.cents != null && <span className="font-light normal-case tracking-normal"> · {formatBRL(c.cents)}</span>}
            </CmChip>
          ))}
        </div>

        <div className="flex flex-col gap-1 border-l-4 border-cm-accent bg-cm-card px-4 py-3">
          {valid ? (
            <>
              <p className="text-[14px] font-bold text-cm-ink">
                Vamos avisar quando custar {formatBRL(cents)} ou menos.
              </p>
              {alreadyThere ? (
                <p className="text-[13px] font-bold text-cm-accent">Já está nesse preço agora!</p>
              ) : (
                <p className="text-[13px] font-light text-cm-body">
                  {!ready
                    ? "Verificando o histórico…"
                    : daysHit > 0
                      ? `Esse preço apareceu em ${daysHit} dos últimos 90 dias.`
                      : "Nunca vimos esse preço; pode demorar."}
                </p>
              )}
            </>
          ) : (
            <p className="text-[13px] font-light text-cm-body">Digite o preço (já com frete) em que vale comprar.</p>
          )}
          <p className="text-[12px] font-light text-cm-muted">O preço comparado já inclui frete e desconto no Pix.</p>
        </div>

        <label className="flex cursor-pointer items-center gap-3 text-[14px] font-light text-cm-body-strong">
          <input
            type="checkbox"
            checked={newLow}
            onChange={(e) => setNewLow(e.target.checked)}
            className="h-4 w-4 cursor-pointer rounded-none accent-[#2dc98a]"
          />
          Também avisar se aparecer um novo menor preço
        </label>

        <CmDialogFooter className="justify-between">
          <div>
            {hasRule && (
              <CmButton variant="danger-ghost" disabled={busy} onClick={() => save(false)}>
                Remover aviso
              </CmButton>
            )}
          </div>
          <div className="flex gap-3">
            <CmButton variant="primary-outline" disabled={busy} onClick={onClose}>
              Cancelar
            </CmButton>
            <CmButton variant="strong" disabled={busy || !valid} onClick={() => save(true)}>
              {busy ? "Salvando…" : "Avisar"}
            </CmButton>
          </div>
        </CmDialogFooter>
      </CmDialogContent>
    </CmDialog>
  );
}
