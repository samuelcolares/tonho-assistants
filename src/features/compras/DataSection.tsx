import { useState } from "react";
import { Database, Download, FileSpreadsheet, Upload } from "lucide-react";
import { comprasBackup, comprasExportCsv, comprasRestore, pickBackupFile, pickBackupSavePath, pickCsvSavePath } from "@/api";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, todayInputValue } from "./format";
import { SettingRow } from "./SettingsParts";
import { ConfirmDialog } from "./shared";
import { CmButton } from "./ui";
import { ImportReportDialog, useImportXlsx } from "./useImportXlsx";

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** Backup, restore, CSV export and spreadsheet re-import. Restoring always asks first and keeps a copy of the current state. */
export function DataSection({ onImported, onRestored }: { onImported: () => void; onRestored: () => void }) {
  const { toast } = useToast();
  const importer = useImportXlsx(onImported);
  const [busy, setBusy] = useState<"backup" | "restore" | "csv" | null>(null);
  const [restorePath, setRestorePath] = useState<string | null>(null);

  const backup = async () => {
    try {
      const path = await pickBackupSavePath(`compras-backup-${todayInputValue()}.db`);
      if (!path) return;
      setBusy("backup");
      const saved = await comprasBackup(path);
      toast({ variant: "success", title: "Backup salvo", description: saved });
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível fazer o backup", description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const pickRestore = async () => {
    try {
      const path = await pickBackupFile();
      if (path) setRestorePath(path);
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível abrir o arquivo", description: errorMessage(e) });
    }
  };

  const restore = async () => {
    if (!restorePath) return;
    setBusy("restore");
    try {
      const safety = await comprasRestore(restorePath);
      setRestorePath(null);
      toast({ variant: "success", title: "Backup restaurado", description: `O estado de antes ficou guardado em ${safety}` });
      onRestored();
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível restaurar", description: errorMessage(e) });
      setRestorePath(null);
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = async () => {
    try {
      const path = await pickCsvSavePath();
      if (!path) return;
      setBusy("csv");
      const n = await comprasExportCsv(path);
      toast({ variant: "success", title: "CSV exportado", description: `${n} linhas salvas.` });
    } catch (e) {
      toast({ variant: "danger", title: "Falha ao exportar", description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <SettingRow
        label="Backup"
        hint="Guarda uma cópia de tudo (itens, preços, avisos e configurações) no arquivo que você escolher. As fotos dos produtos não entram."
      >
        <CmButton onClick={backup} disabled={busy != null}>
          <Database className="h-4 w-4" /> {busy === "backup" ? "Salvando…" : "Fazer backup agora"}
        </CmButton>
        <CmButton onClick={pickRestore} disabled={busy != null}>
          <Upload className="h-4 w-4" /> Restaurar backup
        </CmButton>
      </SettingRow>
      <SettingRow label="Planilha de compras" hint="Exporta tudo para abrir no Excel, ou importa de novo a planilha: itens existentes são atualizados, não duplicados.">
        <CmButton onClick={exportCsv} disabled={busy != null}>
          <Download className="h-4 w-4" /> Exportar CSV
        </CmButton>
        <CmButton onClick={importer.start} disabled={importer.busy}>
          <FileSpreadsheet className="h-4 w-4" /> {importer.busy ? "Importando…" : "Reimportar planilha"}
        </CmButton>
      </SettingRow>

      <ConfirmDialog
        open={restorePath != null}
        title="Restaurar backup?"
        description={
          <>
            <span className="block">Isso substitui todos os dados atuais pelo backup. Um backup do estado atual será salvo antes.</span>
            {restorePath && <span className="mt-3 block break-all text-[13px] text-cm-muted">Arquivo: {fileName(restorePath)}</span>}
          </>
        }
        confirmLabel="Restaurar"
        busy={busy === "restore"}
        onConfirm={restore}
        onCancel={() => setRestorePath(null)}
      />
      <ImportReportDialog report={importer.report} onClose={importer.clearReport} />
    </>
  );
}
