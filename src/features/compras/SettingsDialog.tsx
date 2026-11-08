import { useEffect, useState } from "react";
import { Download, FileSpreadsheet, Plus, Trash2 } from "lucide-react";
import { comprasExportCsv, comprasGetSettings, comprasSaveSettings, pickCsvSavePath } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { ComprasSettings } from "@/types";
import { errorMessage } from "./format";
import { Field } from "./shared";
import { ImportReportDialog, useImportXlsx } from "./useImportXlsx";
import { MlApiSection } from "./MlApiSection";

interface PixRow {
  store: string;
  pct: string;
}

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function SettingsDialog({ open, onClose, onImported }: SettingsDialogProps) {
  const { toast } = useToast();
  const importer = useImportXlsx(onImported);
  const [settings, setSettings] = useState<ComprasSettings | null>(null);
  const [rows, setRows] = useState<PixRow[]>([]);
  const [interval, setIntervalMin] = useState("120");
  const [amazon, setAmazon] = useState("360");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    comprasGetSettings()
      .then((s) => {
        setSettings(s);
        setIntervalMin(String(s.pollIntervalMinutes));
        setAmazon(String(s.amazonMinIntervalMinutes));
        setRows(Object.entries(s.pixDiscountByStore).map(([store, pct]) => ({ store, pct: String(pct) })));
      })
      .catch((e) => toast({ variant: "danger", title: "Falha ao carregar configurações", description: errorMessage(e) }));
  }, [open, toast]);

  const save = async () => {
    if (!settings) return;
    const pix: Record<string, number> = {};
    for (const r of rows) {
      const store = r.store.trim();
      const pct = Number(r.pct.replace(",", "."));
      if (store && Number.isFinite(pct) && pct >= 0 && pct < 100) pix[store] = pct;
    }
    const next: ComprasSettings = {
      ...settings,
      pollIntervalMinutes: clamp(Math.round(Number(interval) || 120), 60, 180),
      amazonMinIntervalMinutes: Math.max(60, Math.round(Number(amazon) || 360)),
      cep: settings.cep?.trim() ? settings.cep.trim() : null,
      pixDiscountByStore: pix,
    };
    setSaving(true);
    try {
      await comprasSaveSettings(next);
      toast({ variant: "success", title: "Configurações salvas" });
      onClose();
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível salvar", description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = async () => {
    try {
      const path = await pickCsvSavePath();
      if (!path) return;
      const n = await comprasExportCsv(path);
      toast({ variant: "success", title: "CSV exportado", description: `${n} linhas salvas.` });
    } catch (e) {
      toast({ variant: "danger", title: "Falha ao exportar", description: errorMessage(e) });
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Configurações de Compras</DialogTitle>
            <DialogDescription>Verificação automática de preços, descontos Pix e dados.</DialogDescription>
          </DialogHeader>

          {!settings ? (
            <p className="py-6 text-center text-sm text-ink-muted">Carregando…</p>
          ) : (
            <div className="flex flex-col gap-4">
              <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg-100 px-3 py-2.5">
                <span className="flex flex-col">
                  <span className="text-[13px] font-semibold text-ink">Verificar preços automaticamente</span>
                  <span className="text-[12px] text-ink-muted">Consulta as lojas em segundo plano.</span>
                </span>
                <Switch
                  checked={settings.pollEnabled}
                  onCheckedChange={(v) => setSettings({ ...settings, pollEnabled: v })}
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Intervalo (min)" hint="Entre 60 e 180.">
                  <Input type="number" min={60} max={180} value={interval} onChange={(e) => setIntervalMin(e.target.value)} />
                </Field>
                <Field label="Intervalo mínimo Amazon (min)" hint="Amazon bloqueia consultas frequentes.">
                  <Input type="number" min={60} value={amazon} onChange={(e) => setAmazon(e.target.value)} />
                </Field>
                <Field label="CEP" hint="Reservado para cálculo de frete.">
                  <Input
                    value={settings.cep ?? ""}
                    onChange={(e) => setSettings({ ...settings, cep: e.target.value })}
                    placeholder="00000-000"
                  />
                </Field>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Desconto Pix por loja (%)</span>
                  <Button size="sm" variant="ghost" onClick={() => setRows([...rows, { store: "", pct: "5" }])}>
                    <Plus className="h-3.5 w-3.5" /> Adicionar
                  </Button>
                </div>
                <p className="text-[12px] text-ink-faint">
                  Usado quando a página não informa o preço Pix: o app estima preço cheio menos esse desconto.
                </p>
                {rows.length === 0 && <p className="text-[12.5px] text-ink-faint">Nenhuma loja configurada.</p>}
                {rows.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={r.store}
                      placeholder="Loja (ex.: Amazon)"
                      onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, store: e.target.value } : x)))}
                    />
                    <Input
                      className="w-24"
                      inputMode="decimal"
                      value={r.pct}
                      onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))}
                    />
                    <Button size="icon" variant="ghost" aria-label="Remover" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <MlApiSection open={open} />

              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                <Button variant="secondary" size="sm" onClick={exportCsv}>
                  <Download className="h-4 w-4" /> Exportar CSV
                </Button>
                <Button variant="secondary" size="sm" onClick={importer.start} disabled={importer.busy}>
                  <FileSpreadsheet className="h-4 w-4" /> {importer.busy ? "Importando…" : "Reimportar planilha"}
                </Button>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={!settings || saving}>
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ImportReportDialog report={importer.report} onClose={importer.clearReport} />
    </>
  );
}
