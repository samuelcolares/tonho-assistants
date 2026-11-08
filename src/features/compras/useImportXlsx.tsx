import { useCallback, useState } from "react";
import { comprasImportXlsx, pickXlsxFile } from "@/api";
import { useToast } from "@/hooks/use-toast";
import type { ImportReport } from "@/types";
import { errorMessage } from "./format";
import { formatBRL } from "./money";
import { CmButton, CmDialog, CmDialogContent, CmDialogDescription, CmDialogFooter, CmDialogTitle } from "./ui";

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
    <CmDialog open={report != null} onOpenChange={(o) => !o && onClose()}>
      <CmDialogContent className="max-w-lg">
        {report && (
          <>
            <div className="flex flex-col gap-2 pr-8">
              <CmDialogTitle>Planilha importada</CmDialogTitle>
              <CmDialogDescription>
                {report.inserted} novos, {report.updated} atualizados
                {report.skipped > 0 ? `, ${report.skipped} ignorados` : ""}. {report.boughtImported} já marcados como comprados.
              </CmDialogDescription>
            </div>
            <dl className="grid grid-cols-3 gap-3 border border-cm-hairline bg-cm-soft p-4 text-[13px]">
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-[1.5px] text-cm-muted">Orçamento</dt>
                <dd className="mt-1 font-bold tabular-nums text-cm-ink">{formatBRL(report.totalBudgetCents)}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-[1.5px] text-cm-muted">Comprado</dt>
                <dd className="mt-1 font-bold tabular-nums text-cm-accent">{formatBRL(report.boughtCents)}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-[1.5px] text-cm-muted">Falta</dt>
                <dd className="mt-1 font-bold tabular-nums text-cm-ink">{formatBRL(report.remainingBudgetCents)}</dd>
              </div>
            </dl>
            {report.errors.length > 0 && (
              <div className="max-h-32 overflow-y-auto border border-cm-warn p-3 text-[13px] text-cm-warn">
                <p className="mb-1 font-bold">{report.errors.length} avisos</p>
                <ul className="list-disc pl-4">
                  {report.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
            <CmDialogFooter>
              <CmButton variant="strong" onClick={onClose}>
                Fechar
              </CmButton>
            </CmDialogFooter>
          </>
        )}
      </CmDialogContent>
    </CmDialog>
  );
}
