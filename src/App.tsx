import { useEffect, useMemo, useState } from "react";
import {
  Folder,
  Plus,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  Trash2,
  Zap,
} from "lucide-react";
import { Sidebar, type View } from "@/components/Sidebar";
import { VaultCard } from "@/components/VaultCard";
import { RepoStatsView } from "@/components/RepoStats";
import { ReminderItem } from "@/components/ReminderItem";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  checkAppUpdate,
  clearActivity,
  deleteReminder,
  deleteVaultEntry,
  ensureNotificationPermission,
  getActivity,
  getConfig,
  getReminders,
  getVaultEntries,
  onActivity,
  onWatcherError,
  onWatcherStatus,
  pickFolder,
  runActionRulesNow,
  saveConfig,
  saveReminder,
  saveVaultEntry,
  scanWatcher,
  undoActivity,
} from "@/api";
import type {
  ActionRule,
  ActivityEntry,
  AppConfig,
  ExtensionRule,
  KeywordMatchType,
  KeywordRule,
  Reminder,
  ReminderRepeat,
  VaultEntry,
  WatcherConfig,
} from "@/types";

const uid = () => crypto.randomUUID();

function emptyWatcher(): WatcherConfig {
  return { id: uid(), name: "Nova pasta", folder: "", enabled: true, extensionRules: [], keywordRules: [] };
}
function emptyExtensionRule(): ExtensionRule {
  return { id: uid(), name: "Nova regra", extensions: [], destination: "", enabled: true };
}
function emptyKeywordRule(): KeywordRule {
  return { id: uid(), keyword: "", matchType: "contains", extensions: [], destination: "", enabled: true };
}
function emptyActionRule(watcherId: string): ActionRule {
  return { id: uid(), name: "Nova regra de ação", watcherId, extensions: ["exe"], olderThanDays: 3, action: "delete", enabled: true };
}
function parseExtensions(raw: string): string[] {
  return raw.split(",").map((s) => s.trim().replace(/^\./, "").toLowerCase()).filter(Boolean);
}
function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}
function formatDueDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}
function toDatetimeLocal(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}
function fromDatetimeLocal(value: string): string {
  return new Date(value).toISOString();
}

const VIEW_TITLES: Record<View, string> = {
  watchers: "Pastas monitoradas",
  actions: "Regras de ação",
  activity: "Atividade recente",
  reminders: "Lembretes & agenda",
  vault: "Vault",
  repos: "Repos",
  settings: "Configurações",
};

export default function App() {
  const { toast } = useToast();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [vaultEntries, setVaultEntries] = useState<VaultEntry[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [status, setStatus] = useState<"running" | "stopped" | "error">("running");
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<View>("watchers");
  const [scanBusy, setScanBusy] = useState<string | null>(null);

  useEffect(() => {
    getConfig().then((cfg) => {
      setConfig(cfg);
      setSavedSnapshot(JSON.stringify(cfg));
    });
    getActivity().then(setActivity);
    getVaultEntries().then(setVaultEntries);
    getReminders().then(setReminders);
    ensureNotificationPermission();

    const unlistenActivity = onActivity((entry) => setActivity((prev) => [entry, ...prev].slice(0, 200)));
    const unlistenError = onWatcherError((msg) => {
      toast({ variant: "danger", title: "Erro no monitoramento", description: msg });
      setStatus("error");
    });
    const unlistenStatus = onWatcherStatus((s) => {
      setStatus(s === "running" ? "running" : "stopped");
    });
    const remindersPoll = window.setInterval(() => getReminders().then(setReminders), 20000);

    return () => {
      unlistenActivity.then((f) => f());
      unlistenError.then((f) => f());
      unlistenStatus.then((f) => f());
      window.clearInterval(remindersPoll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = useMemo(() => (config ? JSON.stringify(config) !== savedSnapshot : false), [config, savedSnapshot]);

  if (!config) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-bg-000">
        <div className="h-10 w-10 animate-pulse rounded-full bg-brand-gradient shadow-[0_0_40px_4px_rgba(124,92,255,0.45)]" />
        <p className="text-sm text-ink-muted">Iniciando Tonho Assistants…</p>
      </div>
    );
  }

  const update = (patch: Partial<AppConfig>) => setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
  const updateWatcher = (id: string, patch: Partial<WatcherConfig>) =>
    update({ watchers: config.watchers.map((w) => (w.id === id ? { ...w, ...patch } : w)) });

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveConfig(config);
      setSavedSnapshot(JSON.stringify(config));
      toast({ variant: "success", description: "Alterações salvas." });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveWatcher = (id: string) => {
    update({
      watchers: config.watchers.filter((w) => w.id !== id),
      actionRules: config.actionRules.filter((r) => r.watcherId !== id),
    });
  };

  const handleScan = async (watcherId: string, watcherName: string) => {
    setScanBusy(watcherId);
    try {
      const result = await scanWatcher(watcherId);
      toast({ description: `"${watcherName}": ${result.moved} movido(s), ${result.skipped} ignorado(s).` });
      getActivity().then(setActivity);
    } catch (e) {
      toast({ variant: "danger", title: "Erro ao organizar", description: String(e) });
    } finally {
      setScanBusy(null);
    }
  };

  const handleRunActionRulesNow = async () => {
    const count = await runActionRulesNow();
    toast({ variant: count > 0 ? "warning" : "default", description: `${count} arquivo(s) removido(s) pelas regras de ação.` });
    getActivity().then(setActivity);
  };

  const handleUndo = async (entryId: string) => {
    try {
      await undoActivity(entryId);
      toast({ variant: "success", description: "Movimentação desfeita." });
      getActivity().then(setActivity);
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível desfazer", description: String(e) });
    }
  };

  const handleSaveVaultEntry = async (entry: Partial<VaultEntry> & { label: string; content: string }) => {
    const saved = await saveVaultEntry(entry);
    setVaultEntries((prev) => {
      const exists = prev.some((e) => e.id === saved.id);
      return exists ? prev.map((e) => (e.id === saved.id ? saved : e)) : [saved, ...prev];
    });
  };
  const handleDeleteVaultEntry = async (id: string) => {
    await deleteVaultEntry(id);
    setVaultEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const handleSaveReminder = async (r: Partial<Reminder> & Pick<Reminder, "title" | "dueAt" | "repeat">) => {
    const saved = await saveReminder(r);
    setReminders((prev) => {
      const exists = prev.some((x) => x.id === saved.id);
      return exists ? prev.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...prev];
    });
  };
  const handleDeleteReminder = async (id: string) => {
    await deleteReminder(id);
    setReminders((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <div className="flex h-screen bg-bg-000">
      <Sidebar
        view={view}
        onChangeView={setView}
        status={status}
        autostart={config.autostart}
        onToggleAutostart={() => update({ autostart: !config.autostart })}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <h1 className="text-[22px] font-semibold leading-7 text-ink">{VIEW_TITLES[view]}</h1>
          <Button onClick={handleSave} disabled={!dirty || saving}>
            {saving ? "Salvando…" : "Salvar alterações"}
          </Button>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          {view === "watchers" && (
            <WatchersView
              config={config}
              onUpdate={update}
              onUpdateWatcher={updateWatcher}
              onRemoveWatcher={handleRemoveWatcher}
              onScan={handleScan}
              scanBusy={scanBusy}
            />
          )}
          {view === "actions" && (
            <ActionsView config={config} onUpdate={update} onRunNow={handleRunActionRulesNow} />
          )}
          {view === "activity" && (
            <ActivityView
              activity={activity}
              onUndo={handleUndo}
              onClear={() => {
                clearActivity();
                setActivity([]);
              }}
            />
          )}
          {view === "reminders" && (
            <RemindersView reminders={reminders} onSave={handleSaveReminder} onDelete={handleDeleteReminder} />
          )}
          {view === "vault" && (
            <VaultView entries={vaultEntries} onSave={handleSaveVaultEntry} onDelete={handleDeleteVaultEntry} />
          )}
          {view === "repos" && <RepoStatsView />}
          {view === "settings" && <SettingsView config={config} onUpdate={update} />}
        </main>
      </div>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="max-w-xs text-sm text-ink-muted">{description}</p>
    </div>
  );
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Excluir",
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-ink-muted">{description}</p>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WatchersView({
  config,
  onUpdate,
  onUpdateWatcher,
  onRemoveWatcher,
  onScan,
  scanBusy,
}: {
  config: AppConfig;
  onUpdate: (patch: Partial<AppConfig>) => void;
  onUpdateWatcher: (id: string, patch: Partial<WatcherConfig>) => void;
  onRemoveWatcher: (id: string) => void;
  onScan: (id: string, name: string) => void;
  scanBusy: string | null;
}) {
  const [deleteTarget, setDeleteTarget] = useState<WatcherConfig | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-xl text-[13px] leading-relaxed text-ink-muted">
          Cada pasta monitorada tem suas próprias regras. Arquivos que chegam nela são movidos
          automaticamente; use "Organizar agora" para aplicar as regras aos arquivos que já estão lá.
        </p>
        <Button onClick={() => onUpdate({ watchers: [...config.watchers, emptyWatcher()] })}>
          <Plus className="h-4 w-4" /> Nova pasta
        </Button>
      </div>

      {config.watchers.length === 0 && (
        <EmptyState title="Nenhuma pasta monitorada ainda" description="Adicione uma pasta para o Antonio começar a organizar." />
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(440px,1fr))] gap-4">
        {config.watchers.map((watcher) => (
          <WatcherCard
            key={watcher.id}
            watcher={watcher}
            otherWatchers={config.watchers.filter((w) => w.id !== watcher.id)}
            onChange={(patch) => onUpdateWatcher(watcher.id, patch)}
            onRequestDelete={() => setDeleteTarget(watcher)}
            onScan={() => onScan(watcher.id, watcher.name)}
            scanning={scanBusy === watcher.id}
          />
        ))}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title={`Excluir "${deleteTarget?.name}"?`}
        description="A pasta deixa de ser monitorada e suas regras (incluindo regras de ação associadas) são removidas. Os arquivos em si não são afetados."
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={() => deleteTarget && onRemoveWatcher(deleteTarget.id)}
      />
    </div>
  );
}

function WatcherCard({
  watcher,
  otherWatchers,
  onChange,
  onRequestDelete,
  onScan,
  scanning,
}: {
  watcher: WatcherConfig;
  otherWatchers: WatcherConfig[];
  onChange: (patch: Partial<WatcherConfig>) => void;
  onRequestDelete: () => void;
  onScan: () => void;
  scanning: boolean;
}) {
  const [importFrom, setImportFrom] = useState("");

  const handleChooseFolder = async () => {
    const folder = await pickFolder(watcher.folder || undefined);
    if (folder) onChange({ folder });
  };

  const handleImport = (sourceId: string) => {
    const source = otherWatchers.find((w) => w.id === sourceId);
    if (!source) return;
    onChange({
      extensionRules: [...watcher.extensionRules, ...source.extensionRules.map((r) => ({ ...r, id: uid() }))],
      keywordRules: [...watcher.keywordRules, ...source.keywordRules.map((r) => ({ ...r, id: uid() }))],
    });
    setImportFrom("");
  };

  return (
    <Card className={cnDisabled(!watcher.enabled, "flex flex-col gap-4")}>
      <div className="flex items-center gap-3">
        <Folder className="h-4 w-4 shrink-0 text-antonio" />
        <Input
          className="flex-1 border-none bg-transparent p-0 text-[14.5px] font-semibold shadow-none focus-visible:ring-0"
          value={watcher.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Nome da pasta monitorada"
        />
        <Switch checked={watcher.enabled} onCheckedChange={(v) => onChange({ enabled: v })} />
        <Button variant="ghost" size="icon" onClick={onRequestDelete} className="hover:bg-danger-subtle hover:text-danger">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex gap-2">
        <Input
          className="font-mono text-[13px]"
          value={watcher.folder}
          onChange={(e) => onChange({ folder: e.target.value })}
          placeholder="C:\Users\voce\Downloads"
        />
        <Button variant="secondary" size="sm" onClick={handleChooseFolder}>
          Escolher…
        </Button>
        <Button variant="secondary" size="sm" onClick={onScan} disabled={scanning || !watcher.folder}>
          {scanning ? "Organizando…" : "Organizar agora"}
        </Button>
      </div>

      {otherWatchers.length > 0 && (
        <Select value={importFrom} onValueChange={(v) => { setImportFrom(v); handleImport(v); }}>
          <SelectTrigger>
            <SelectValue placeholder="Importar regras de outra pasta…" />
          </SelectTrigger>
          <SelectContent>
            {otherWatchers.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <RuleGroup
        title="Regras por extensão"
        onAdd={() => onChange({ extensionRules: [...watcher.extensionRules, emptyExtensionRule()] })}
      >
        {watcher.extensionRules.length === 0 && <MiniEmpty text="Nenhuma regra de extensão." />}
        {watcher.extensionRules.map((rule) => (
          <ExtensionRuleForm
            key={rule.id}
            rule={rule}
            onChange={(updated) =>
              onChange({ extensionRules: watcher.extensionRules.map((r) => (r.id === updated.id ? updated : r)) })
            }
            onRemove={() => onChange({ extensionRules: watcher.extensionRules.filter((r) => r.id !== rule.id) })}
          />
        ))}
      </RuleGroup>

      <RuleGroup
        title="Regras por nome de arquivo"
        onAdd={() => onChange({ keywordRules: [...watcher.keywordRules, emptyKeywordRule()] })}
      >
        {watcher.keywordRules.length === 0 && <MiniEmpty text="Nenhuma regra de nome de arquivo." />}
        {watcher.keywordRules.map((rule) => (
          <KeywordRuleForm
            key={rule.id}
            rule={rule}
            onChange={(updated) =>
              onChange({ keywordRules: watcher.keywordRules.map((r) => (r.id === updated.id ? updated : r)) })
            }
            onRemove={() => onChange({ keywordRules: watcher.keywordRules.filter((r) => r.id !== rule.id) })}
          />
        ))}
      </RuleGroup>
    </Card>
  );
}

function cnDisabled(disabled: boolean, base: string) {
  return disabled ? `${base} opacity-60` : base;
}

function MiniEmpty({ text }: { text: string }) {
  return <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[12px] text-ink-faint">{text}</p>;
}

function RuleGroup({ title, onAdd, children }: { title: string; onAdd: () => void; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{title}</h3>
        <Button variant="ghost" size="sm" onClick={onAdd} className="h-6 px-2 text-[11.5px]">
          <Plus className="h-3 w-3" /> Adicionar
        </Button>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function ExtensionRuleForm({
  rule,
  onChange,
  onRemove,
}: {
  rule: ExtensionRule;
  onChange: (rule: ExtensionRule) => void;
  onRemove: () => void;
}) {
  const handleChooseDestination = async () => {
    const folder = await pickFolder(rule.destination || undefined);
    if (folder) onChange({ ...rule, destination: folder });
  };

  return (
    <div className={cnDisabled(!rule.enabled, "flex flex-col gap-2 rounded-md border border-border bg-bg-200 p-3")}>
      <div className="flex items-center gap-2">
        <Input
          className="h-7 flex-1 text-[12.5px] font-semibold"
          value={rule.name}
          onChange={(e) => onChange({ ...rule, name: e.target.value })}
          placeholder="Nome da regra"
        />
        <Switch checked={rule.enabled} onCheckedChange={(v) => onChange({ ...rule, enabled: v })} />
        <Button variant="ghost" size="icon" onClick={onRemove} className="h-6 w-6 hover:bg-danger-subtle hover:text-danger">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      <Input
        className="h-7 text-[12.5px]"
        value={rule.extensions.join(", ")}
        onChange={(e) => onChange({ ...rule, extensions: parseExtensions(e.target.value) })}
        placeholder="Extensões: png, jpg, jpeg"
      />
      <div className="flex gap-2">
        <Input
          className="h-7 flex-1 font-mono text-[12px]"
          value={rule.destination}
          onChange={(e) => onChange({ ...rule, destination: e.target.value })}
          placeholder="Pasta de destino"
        />
        <Button variant="secondary" size="sm" className="h-7 px-2 text-[11.5px]" onClick={handleChooseDestination}>
          Escolher…
        </Button>
      </div>
    </div>
  );
}

const MATCH_TYPE_LABELS: Record<KeywordMatchType, string> = {
  contains: "contém",
  starts_with: "começa com",
  exact: "é exatamente",
};

function KeywordRuleForm({
  rule,
  onChange,
  onRemove,
}: {
  rule: KeywordRule;
  onChange: (rule: KeywordRule) => void;
  onRemove: () => void;
}) {
  const handleChooseDestination = async () => {
    const folder = await pickFolder(rule.destination || undefined);
    if (folder) onChange({ ...rule, destination: folder });
  };

  return (
    <div className={cnDisabled(!rule.enabled, "flex flex-col gap-2 rounded-md border border-border bg-bg-200 p-3")}>
      <div className="flex items-center gap-2">
        <Select value={rule.matchType} onValueChange={(v) => onChange({ ...rule, matchType: v as KeywordMatchType })}>
          <SelectTrigger className="h-7 w-[130px] shrink-0 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(MATCH_TYPE_LABELS) as KeywordMatchType[]).map((mt) => (
              <SelectItem key={mt} value={mt}>
                {MATCH_TYPE_LABELS[mt]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="h-7 flex-1 text-[12.5px]"
          value={rule.keyword}
          onChange={(e) => onChange({ ...rule, keyword: e.target.value })}
          placeholder="Palavra-chave"
        />
        <Switch checked={rule.enabled} onCheckedChange={(v) => onChange({ ...rule, enabled: v })} />
        <Button variant="ghost" size="icon" onClick={onRemove} className="h-6 w-6 hover:bg-danger-subtle hover:text-danger">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      <Input
        className="h-7 text-[12.5px]"
        value={rule.extensions.join(", ")}
        onChange={(e) => onChange({ ...rule, extensions: parseExtensions(e.target.value) })}
        placeholder="Extensões (vazio = qualquer uma)"
      />
      <div className="flex gap-2">
        <Input
          className="h-7 flex-1 font-mono text-[12px]"
          value={rule.destination}
          onChange={(e) => onChange({ ...rule, destination: e.target.value })}
          placeholder="Pasta de destino"
        />
        <Button variant="secondary" size="sm" className="h-7 px-2 text-[11.5px]" onClick={handleChooseDestination}>
          Escolher…
        </Button>
      </div>
    </div>
  );
}

function ActionsView({
  config,
  onUpdate,
  onRunNow,
}: {
  config: AppConfig;
  onUpdate: (patch: Partial<AppConfig>) => void;
  onRunNow: () => void;
}) {
  const hasWatchers = config.watchers.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-xl text-[13px] leading-relaxed text-ink-muted">
          Regras de ação rodam periodicamente (não reagem em tempo real) e podem excluir arquivos
          antigos. Verificação a cada <strong className="text-ink">{config.scanIntervalMinutes} min</strong>.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={onRunNow}>
            Rodar agora
          </Button>
          {hasWatchers && (
            <Button onClick={() => onUpdate({ actionRules: [...config.actionRules, emptyActionRule(config.watchers[0].id)] })}>
              <Plus className="h-4 w-4" /> Nova regra
            </Button>
          )}
        </div>
      </div>

      {!hasWatchers && (
        <EmptyState title="Nenhuma pasta monitorada" description="Crie uma pasta monitorada primeiro — regras de ação atuam sobre ela." />
      )}
      {hasWatchers && config.actionRules.length === 0 && (
        <EmptyState title="Nenhuma regra de ação" description="Adicione uma regra para excluir arquivos automaticamente por idade." />
      )}

      <div className="flex flex-col gap-3">
        {config.actionRules.map((rule) => (
          <ActionRuleForm
            key={rule.id}
            rule={rule}
            watchers={config.watchers}
            onChange={(updated) => onUpdate({ actionRules: config.actionRules.map((r) => (r.id === updated.id ? updated : r)) })}
            onRemove={() => onUpdate({ actionRules: config.actionRules.filter((r) => r.id !== rule.id) })}
          />
        ))}
      </div>
    </div>
  );
}

function ActionRuleForm({
  rule,
  watchers,
  onChange,
  onRemove,
}: {
  rule: ActionRule;
  watchers: WatcherConfig[];
  onChange: (rule: ActionRule) => void;
  onRemove: () => void;
}) {
  return (
    <Card className={cnDisabled(!rule.enabled, "flex flex-col gap-3 border-warning/25")}>
      <div className="flex items-center gap-3">
        <Zap className="h-4 w-4 shrink-0 text-warning" />
        <Input
          className="flex-1 border-none bg-transparent p-0 text-[14px] font-semibold shadow-none focus-visible:ring-0"
          value={rule.name}
          onChange={(e) => onChange({ ...rule, name: e.target.value })}
          placeholder="Nome da regra"
        />
        <Switch checked={rule.enabled} onCheckedChange={(v) => onChange({ ...rule, enabled: v })} />
        <Button variant="ghost" size="icon" onClick={onRemove} className="hover:bg-danger-subtle hover:text-danger">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Pasta monitorada</Label>
          <Select value={rule.watcherId} onValueChange={(v) => onChange({ ...rule, watcherId: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {watchers.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Extensões (vazio = qualquer)</Label>
          <Input
            value={rule.extensions.join(", ")}
            onChange={(e) => onChange({ ...rule, extensions: parseExtensions(e.target.value) })}
            placeholder="exe, msi"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Excluir após (dias)</Label>
          <Input
            type="number"
            min={0}
            value={rule.olderThanDays}
            onChange={(e) => onChange({ ...rule, olderThanDays: Math.max(0, Number(e.target.value)) })}
          />
        </div>
      </div>
      <p className="text-[11.5px] text-warning">
        ⚠ Arquivos que baterem com essa regra serão <strong>excluídos permanentemente</strong> do disco.
      </p>
    </Card>
  );
}

function ActivityView({
  activity,
  onUndo,
  onClear,
}: {
  activity: ActivityEntry[];
  onUndo: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-ink-muted">Histórico de movimentações, exclusões e erros.</p>
        <Button variant="ghost" size="sm" onClick={onClear}>
          Limpar
        </Button>
      </div>

      {activity.length === 0 ? (
        <EmptyState title="Nenhuma atividade ainda" description="Assim que um arquivo for movido ou excluído, aparece aqui." />
      ) : (
        <div className="flex flex-col gap-2">
          {activity.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 rounded-lg border border-border bg-bg-100 p-3">
              <ActivityIcon status={entry.status} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <strong className="truncate text-[13px] text-ink">{entry.fileName}</strong>
                  {entry.ruleName && <Badge variant="antonio">{entry.ruleName}</Badge>}
                </div>
                {entry.status === "moved" && <p className="truncate text-[11.5px] text-ink-faint">→ {entry.to}</p>}
                {entry.status === "deleted" && <p className="truncate text-[11.5px] text-warning">excluído — {entry.from}</p>}
                {entry.status === "error" && <p className="truncate text-[11.5px] text-danger">{entry.message}</p>}
              </div>
              {entry.status === "moved" && entry.ruleName !== "Desfazer" && (
                <Button variant="ghost" size="sm" onClick={() => onUndo(entry.id)}>
                  <RotateCcw className="h-3.5 w-3.5" /> Desfazer
                </Button>
              )}
              <span className="shrink-0 text-[11px] text-ink-faint">{formatTime(entry.timestamp)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityIcon({ status }: { status: ActivityEntry["status"] }) {
  if (status === "moved") return <div className="h-2 w-2 shrink-0 rounded-full bg-success" />;
  if (status === "deleted") return <Trash2 className="h-3.5 w-3.5 shrink-0 text-warning" />;
  return <div className="h-2 w-2 shrink-0 rounded-full bg-danger" />;
}

function VaultView({
  entries,
  onSave,
  onDelete,
}: {
  entries: VaultEntry[];
  onSave: (entry: Partial<VaultEntry> & { label: string; content: string }) => void;
  onDelete: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<VaultEntry | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<VaultEntry | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.label.toLowerCase().includes(q) || e.content.toLowerCase().includes(q));
  }, [entries, query]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <p className="max-w-xl text-[13px] leading-relaxed text-ink-muted">
          Guarde qualquer informação que você precise buscar rápido depois — senhas, notas, códigos.
        </p>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Novo item
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por rótulo ou conteúdo…" className="pl-9" />
      </div>

      {creating && (
        <VaultEntryForm
          onCancel={() => setCreating(false)}
          onSave={(data) => {
            onSave(data);
            setCreating(false);
          }}
        />
      )}

      {filtered.length === 0 && !creating && (
        <EmptyState
          title={entries.length === 0 ? "Nenhum item no vault ainda" : "Nada encontrado"}
          description={
            entries.length === 0
              ? "Guarde senhas, chaves e notas que a Bonnie mantém em segurança para você."
              : `Nenhum resultado para "${query}".`
          }
        />
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        {filtered.map((entry) =>
          editing?.id === entry.id ? (
            <VaultEntryForm
              key={entry.id}
              initial={entry}
              onCancel={() => setEditing(null)}
              onSave={(data) => {
                onSave({ ...data, id: entry.id, createdAt: entry.createdAt });
                setEditing(null);
              }}
            />
          ) : (
            <VaultCard
              key={entry.id}
              label={entry.label}
              content={entry.content}
              onEdit={() => setEditing(entry)}
              onDelete={() => setDeleteTarget(entry)}
            />
          )
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title={`Excluir "${deleteTarget?.label}"?`}
        description="Essa ação não pode ser desfeita."
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={() => deleteTarget && onDelete(deleteTarget.id)}
      />
    </div>
  );
}

function VaultEntryForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: VaultEntry;
  onSave: (data: { label: string; content: string }) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [content, setContent] = useState(initial?.content ?? "");

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>Rótulo</Label>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex: Wi-Fi de casa" autoFocus />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Conteúdo</Label>
        <Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Ex: senha: xxxxx" rows={4} className="font-mono" />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button disabled={!label.trim()} onClick={() => onSave({ label: label.trim(), content })}>
          Salvar
        </Button>
      </div>
    </Card>
  );
}

function RemindersView({
  reminders,
  onSave,
  onDelete,
}: {
  reminders: Reminder[];
  onSave: (r: Partial<Reminder> & Pick<Reminder, "title" | "dueAt" | "repeat">) => void;
  onDelete: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Reminder | null>(null);

  const sorted = useMemo(() => [...reminders].sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()), [reminders]);
  const pending = sorted.filter((r) => !r.done);
  const done = sorted.filter((r) => r.done);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <p className="max-w-xl text-[13px] leading-relaxed text-ink-muted">
          Lembretes disparam uma notificação do Windows na hora marcada, mesmo com a janela minimizada na bandeja.
        </p>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Novo lembrete
        </Button>
      </div>

      {creating && (
        <ReminderForm
          onCancel={() => setCreating(false)}
          onSave={(data) => {
            onSave(data);
            setCreating(false);
          }}
        />
      )}

      {pending.length === 0 && !creating && <EmptyState title="Nenhum lembrete pendente" description="Crie um lembrete para o Dante te avisar na hora certa." />}

      <div className="flex flex-col gap-2">
        {pending.map((r) =>
          editing?.id === r.id ? (
            <ReminderForm
              key={r.id}
              initial={r}
              onCancel={() => setEditing(null)}
              onSave={(data) => {
                onSave({ ...data, id: r.id });
                setEditing(null);
              }}
            />
          ) : (
            <ReminderItem
              key={r.id}
              title={r.title}
              datetime={formatDueDate(r.dueAt)}
              repeat={r.repeat}
              overdue={!r.done && new Date(r.dueAt).getTime() < Date.now()}
              notes={r.notes || undefined}
              onToggleDone={() => onSave({ ...r, done: true })}
              onEdit={() => setEditing(r)}
              onDelete={() => onDelete(r.id)}
            />
          )
        )}
      </div>

      {done.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Concluídos ({done.length})</h3>
          {done.map((r) => (
            <ReminderItem
              key={r.id}
              title={r.title}
              datetime={formatDueDate(r.dueAt)}
              repeat={r.repeat}
              done
              onToggleDone={() => onSave({ ...r, done: false })}
              onEdit={() => setEditing(r)}
              onDelete={() => onDelete(r.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReminderForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Reminder;
  onSave: (data: { title: string; notes: string; dueAt: string; repeat: ReminderRepeat }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [dueAt, setDueAt] = useState(initial ? toDatetimeLocal(initial.dueAt) : toDatetimeLocal(new Date().toISOString()));
  const [repeat, setRepeat] = useState<ReminderRepeat>(initial?.repeat ?? "none");

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>Título</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Pagar boleto" autoFocus />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Data e hora</Label>
          <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Repetição</Label>
          <Select value={repeat} onValueChange={(v) => setRepeat(v as ReminderRepeat)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Não repetir</SelectItem>
              <SelectItem value="daily">Diariamente</SelectItem>
              <SelectItem value="weekly">Semanalmente</SelectItem>
              <SelectItem value="monthly">Mensalmente</SelectItem>
              <SelectItem value="yearly">Anualmente</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Notas (opcional)</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          disabled={!title.trim() || !dueAt}
          onClick={() => onSave({ title: title.trim(), notes, dueAt: fromDatetimeLocal(dueAt), repeat })}
        >
          Salvar
        </Button>
      </div>
    </Card>
  );
}

function SettingsView({ config, onUpdate }: { config: AppConfig; onUpdate: (patch: Partial<AppConfig>) => void }) {
  return (
    <div className="flex max-w-lg flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <SettingsIcon className="h-4 w-4 text-ink-muted" />
          <h2 className="text-sm font-semibold text-ink">Verificação periódica</h2>
        </div>
        <p className="text-[12.5px] text-ink-muted">Intervalo em que as regras de ação são reavaliadas em segundo plano.</p>
        <div className="flex flex-col gap-1.5">
          <Label>Minutos entre verificações</Label>
          <Input
            type="number"
            min={1}
            value={config.scanIntervalMinutes}
            onChange={(e) => onUpdate({ scanIntervalMinutes: Math.max(1, Number(e.target.value)) })}
          />
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ink">Inicialização</h2>
        <label className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-ink-muted">Iniciar automaticamente com o Windows (minimizado na bandeja)</span>
          <Switch checked={config.autostart} onCheckedChange={(v) => onUpdate({ autostart: v })} />
        </label>
      </Card>

      <UpdateCard />

      <p className="text-center text-[11.5px] text-ink-faint">Tonho Assistants — fechar a janela mantém o app na bandeja.</p>
    </div>
  );
}

function UpdateCard() {
  const { toast } = useToast();
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [available, setAvailable] = useState<Awaited<ReturnType<typeof checkAppUpdate>> | null>(null);

  const handleCheck = async () => {
    setChecking(true);
    try {
      const result = await checkAppUpdate();
      setAvailable(result);
      if (!result.available) {
        toast({ description: "Você já está na versão mais recente." });
      }
    } catch (e) {
      toast({ variant: "danger", title: "Erro ao verificar atualização", description: String(e) });
    } finally {
      setChecking(false);
    }
  };

  const handleInstall = async () => {
    if (!available?.available) return;
    setInstalling(true);
    try {
      await available.install();
    } catch (e) {
      toast({ variant: "danger", title: "Erro ao instalar atualização", description: String(e) });
      setInstalling(false);
    }
  };

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-ink">Atualizações</h2>
      {available?.available ? (
        <>
          <p className="text-[12.5px] text-ink-muted">
            Nova versão disponível: <strong className="text-ink">{available.version}</strong>
          </p>
          <Button onClick={handleInstall} disabled={installing}>
            {installing ? "Instalando…" : "Instalar e reiniciar"}
          </Button>
        </>
      ) : (
        <>
          <p className="text-[12.5px] text-ink-muted">Verifique se há uma nova versão do Tonho Assistants.</p>
          <Button variant="secondary" onClick={handleCheck} disabled={checking}>
            {checking ? "Verificando…" : "Verificar atualizações"}
          </Button>
        </>
      )}
    </Card>
  );
}
