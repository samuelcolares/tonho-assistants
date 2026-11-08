import { useEffect, useState } from "react";
import { comprasBulkSetTarget, comprasGetSettings } from "@/api";
import { useToast } from "@/hooks/use-toast";
import type { ItemView } from "@/types";
import { errorMessage } from "./format";
import { hasPrice } from "./itemFilters";
import { CmButton, CmDialog, CmDialogContent, CmDialogDescription, CmDialogFooter, CmDialogTitle } from "./ui";

/** Items that can get a bulk alert: not bought, with a price, and no alert switched on yet. */
export function bulkCandidates(items: ItemView[]): ItemView[] {
  return items.filter((v) => !v.item.bought && hasPrice(v) && v.alert?.enabled !== true);
}

interface BulkAlertDialogProps {
  open: boolean;
  candidates: ItemView[];
  onClose: () => void;
  /** Runs after the alerts were set (reload the lists). */
  onDone: () => void | Promise<void>;
}

/** Confirms and runs "turn on an alert at N% below today's price" for every candidate. N comes from the settings. */
export function BulkAlertDialog({ open, candidates, onClose, onDone }: BulkAlertDialogProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(10);

  useEffect(() => {
    if (!open) return;
    comprasGetSettings()
      .then((s) => setPct(s.defaultTargetPct > 0 ? s.defaultTargetPct : 10))
      .catch(() => {});
  }, [open]);

  const confirm = async () => {
    setBusy(true);
    try {
      const n = await comprasBulkSetTarget(
        candidates.map((v) => v.item.id),
        pct
      );
      toast({
        variant: "success",
        title: n === 1 ? "Aviso ligado em 1 item" : `Aviso ligado em ${n} itens`,
        description: `Vamos avisar com ${pct}% abaixo do preço de hoje.`,
      });
      onClose();
      await onDone();
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível ligar os avisos", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <CmDialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <CmDialogContent className="max-w-md">
        <CmDialogTitle>Avisar todos sem alerta</CmDialogTitle>
        <CmDialogDescription>
          Ligar aviso com {pct}% abaixo do preço atual em {candidates.length} {candidates.length === 1 ? "item" : "itens"}?
        </CmDialogDescription>
        <p className="text-[13px] font-light text-cm-muted">
          Só entram itens não comprados que já têm preço e ainda não têm aviso ligado. Você pode ajustar cada um depois.
        </p>
        <CmDialogFooter>
          <CmButton disabled={busy} onClick={onClose}>
            Cancelar
          </CmButton>
          <CmButton variant="strong" disabled={busy || candidates.length === 0} onClick={confirm}>
            {busy ? "Ligando…" : "Ligar avisos"}
          </CmButton>
        </CmDialogFooter>
      </CmDialogContent>
    </CmDialog>
  );
}
