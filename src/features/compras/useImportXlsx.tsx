import { useCallback, useState } from "react";
import { comprasImportXlsx, pickXlsxFile } from "@/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { ImportReport } from "@/types";
import { errorMessage } from "./format";
import { formatBRL } from "./money";

/** Pick an .xlsx, import it, expose the report. `onDone` fires after a successful import. */
export function useImportXlsx(onDone?: () => void) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);

  const start = useCallback(async () => {
    try {
      const path = await pickXlsxFile();
      if (!path) return;
      setBusy(true);
      const r = await comprasImportXlsx(path);
      setReport(r);
      onDone?.();
    } catch (e) {
      toast({ variant: "danger", title: "Falha ao importar planilha", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }, [onDone, toast]);

  return { start, busy, report, clearReport: () => setReport(null) };
}

export function ImportReportDialog({ report, onClose }: { report: ImportReport | null; onClose: () => void }) {
  return (
    <Dialog open={report != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {report && (
          <>
            <DialogHeader>
              <DialogTitle>Planilha importada</DialogTitle>
              <DialogDescription>
                {report.inserted} novos, {report.updated} atualizados
                {report.skipped > 0 ? `, ${report.skipped} ignorados` : ""}. {report.boughtImported} já marcados como comprados.
              </DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-3 gap-3 rounded-md border border-border bg-bg-100 p-3 text-[13px]">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-ink-faint">Orçamento</dt>
                <dd className="font-semibold tabular-nums">{formatBRL(report.totalBudgetCents)}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-ink-faint">Comprado</dt>
                <dd className="font-semibold tabular-nums text-success">{formatBRL(report.boughtCents)}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-ink-faint">Falta</dt>
                <dd className="font-semibold tabular-nums">{formatBRL(report.remainingBudgetCents)}</dd>
              </div>
            </dl>
            {report.errors.length > 0 && (
              <div className="max-h-32 overflow-y-auto rounded-md border border-warning/40 bg-warning-subtle p-3 text-[12.5px] text-warning">
                <p className="mb-1 font-semibold">{report.errors.length} avisos</p>
                <ul className="list-disc pl-4">
                  {report.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
            <DialogFooter>
              <Button onClick={onClose}>Fechar</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
