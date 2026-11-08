import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { check as checkForUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type {
  ActivityEntry,
  AlertEvent,
  AlertRule,
  AppConfig,
  BudgetSummary,
  CategoryTemplate,
  ComprasItem,
  ComprasObservation,
  ComprasOffer,
  ComprasPurchase,
  ComprasSettings,
  Extracted,
  MlStatus,
  HistoryPoint,
  ImportReport,
  ItemView,
  PollStatus,
  GitProject,
  GitProjectStats,
  GitStatsRange,
  GithubTokenStatus,
  Reminder,
  ScanResult,
  VaultEntry,
} from "./types";

export function getConfig(): Promise<AppConfig> {
  return invoke("get_config");
}

export function saveConfig(config: AppConfig): Promise<void> {
  return invoke("save_config", { config });
}

export function getActivity(): Promise<ActivityEntry[]> {
  return invoke("get_activity");
}

export function clearActivity(): Promise<void> {
  return invoke("clear_activity");
}

export function scanWatcher(watcherId: string): Promise<ScanResult> {
  return invoke("scan_watcher", { watcherId });
}

export function runActionRulesNow(): Promise<number> {
  return invoke("run_action_rules_now");
}

export function undoActivity(entryId: string): Promise<void> {
  return invoke("undo_activity", { entryId });
}

export function getVaultEntries(): Promise<VaultEntry[]> {
  return invoke("get_vault_entries");
}

export function saveVaultEntry(entry: Partial<VaultEntry> & { label: string; content: string }): Promise<VaultEntry> {
  return invoke("save_vault_entry", {
    entry: {
      id: entry.id ?? "",
      label: entry.label,
      content: entry.content,
      createdAt: entry.createdAt ?? "",
      updatedAt: entry.updatedAt ?? "",
    },
  });
}

export function deleteVaultEntry(id: string): Promise<void> {
  return invoke("delete_vault_entry", { id });
}

export function getReminders(): Promise<Reminder[]> {
  return invoke("get_reminders");
}

export function saveReminder(reminder: Partial<Reminder> & Pick<Reminder, "title" | "dueAt" | "repeat">): Promise<Reminder> {
  return invoke("save_reminder", {
    reminder: {
      id: reminder.id ?? "",
      title: reminder.title,
      notes: reminder.notes ?? "",
      dueAt: reminder.dueAt,
      repeat: reminder.repeat,
      done: reminder.done ?? false,
      notifiedAt: reminder.notifiedAt ?? null,
    },
  });
}

export function deleteReminder(id: string): Promise<void> {
  return invoke("delete_reminder", { id });
}

export async function ensureNotificationPermission(): Promise<void> {
  try {
    const granted = await isPermissionGranted();
    if (!granted) await requestPermission();
  } catch {
    // best-effort: Windows generally allows notifications without a prompt
  }
}

export function quitApp(): Promise<void> {
  return invoke("quit_app");
}

export type UpdateCheckResult =
  | { available: false }
  | { available: true; version: string; body?: string; install: () => Promise<void> };

export async function checkAppUpdate(): Promise<UpdateCheckResult> {
  const update = await checkForUpdate();
  if (!update) return { available: false };
  return {
    available: true,
    version: update.version,
    body: update.body,
    install: async () => {
      await update.downloadAndInstall();
      await relaunch();
    },
  };
}

export async function pickFolder(defaultPath?: string): Promise<string | null> {
  const result = await open({
    directory: true,
    multiple: false,
    defaultPath,
  });
  if (Array.isArray(result)) return result[0] ?? null;
  return result;
}

export function addGitProject(path: string): Promise<GitProject> {
  return invoke("add_git_project", { path });
}

export function listGitProjects(): Promise<GitProject[]> {
  return invoke("list_git_projects");
}

export function updateGitProject(project: GitProject): Promise<GitProject> {
  return invoke("update_git_project", { project });
}

export function removeGitProject(id: string): Promise<void> {
  return invoke("remove_git_project", { id });
}

export function getGitStats(projectId: string, range: GitStatsRange): Promise<GitProjectStats> {
  return invoke("get_git_stats", { projectId, range });
}

export function refreshGitStats(projectId: string, range: GitStatsRange): Promise<GitProjectStats> {
  return invoke("refresh_git_stats", { projectId, range });
}

export function getGithubTokenStatus(): Promise<GithubTokenStatus> {
  return invoke("get_github_token_status");
}

export function saveGithubToken(token: string): Promise<GithubTokenStatus> {
  return invoke("save_github_token", { token });
}

export function clearGithubToken(): Promise<void> {
  return invoke("clear_github_token");
}

export function onActivity(cb: (entry: ActivityEntry) => void) {
  return listen<ActivityEntry>("activity", (event) => cb(event.payload));
}

export function onWatcherError(cb: (message: string) => void) {
  return listen<string>("watcher-error", (event) => cb(event.payload));
}

export function onWatcherStatus(cb: (status: string) => void) {
  return listen<string>("watcher-status", (event) => cb(event.payload));
}

// --- Compras para Casa ---

/** Archived items are left out unless `includeArchived`. */
export function comprasListItems(includeArchived = false): Promise<ItemView[]> {
  return invoke("compras_list_items", { includeArchived });
}

export function comprasArchiveItem(id: string, archived: boolean): Promise<ItemView> {
  return invoke("compras_archive_item", { id, archived });
}

export function comprasGetItem(id: string): Promise<ItemView> {
  return invoke("compras_get_item", { id });
}

export function comprasUpsertItem(item: ComprasItem): Promise<ComprasItem> {
  return invoke("compras_upsert_item", { item });
}

export function comprasDeleteItem(id: string): Promise<void> {
  return invoke("compras_delete_item", { id });
}

export function comprasMarkBought(purchase: ComprasPurchase): Promise<ItemView> {
  return invoke("compras_mark_bought", { purchase });
}

export function comprasUnmarkBought(itemId: string): Promise<ItemView> {
  return invoke("compras_unmark_bought", { itemId });
}

/** `seed`: preview result of a newly created URL offer, stored as its first price. */
export function comprasUpsertOffer(offer: ComprasOffer, seed: Extracted | null = null): Promise<ComprasOffer> {
  return invoke("compras_upsert_offer", { offer, seed });
}

export function comprasDeleteOffer(id: string): Promise<void> {
  return invoke("compras_delete_offer", { id });
}

export function comprasAddManualPrice(
  offerId: string,
  listCents: number | null,
  cashCents: number | null,
  inStock: boolean | null
): Promise<ComprasObservation> {
  return invoke("compras_add_manual_price", { offerId, listCents, cashCents, inStock });
}

export function comprasPreviewUrl(url: string): Promise<Extracted> {
  return invoke("compras_preview_url", { url });
}

export function comprasSaveImageFromUrl(itemId: string, url: string): Promise<string> {
  return invoke("compras_save_image_from_url", { itemId, url });
}

export function comprasSetImageFromFile(itemId: string, path: string): Promise<string> {
  return invoke("compras_set_image_from_file", { itemId, path });
}

export function comprasHistory(itemId: string, days: number | null): Promise<HistoryPoint[]> {
  return invoke("compras_history", { itemId, days });
}

export function comprasBudgetSummary(): Promise<BudgetSummary> {
  return invoke("compras_budget_summary");
}

export function comprasRefresh(itemId: string | null, offerId: string | null): Promise<void> {
  return invoke("compras_refresh", { itemId, offerId });
}

export function comprasPollStatus(): Promise<PollStatus> {
  return invoke("compras_poll_status");
}

export function comprasListTemplates(): Promise<CategoryTemplate[]> {
  return invoke("compras_list_templates");
}

export function comprasUpsertTemplate(template: CategoryTemplate): Promise<CategoryTemplate> {
  return invoke("compras_upsert_template", { template });
}

export function comprasGetSettings(): Promise<ComprasSettings> {
  return invoke("compras_get_settings");
}

export function comprasSaveSettings(settings: ComprasSettings): Promise<void> {
  return invoke("compras_save_settings", { settings });
}

export function comprasImportXlsx(path: string): Promise<ImportReport> {
  return invoke("compras_import_xlsx", { path });
}

export function comprasExportCsv(path: string): Promise<number> {
  return invoke("compras_export_csv", { path });
}

export async function pickXlsxFile(): Promise<string | null> {
  const result = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Planilha Excel", extensions: ["xlsx"] }],
  });
  if (Array.isArray(result)) return result[0] ?? null;
  return result;
}

export async function pickImageFile(): Promise<string | null> {
  const result = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Imagem", extensions: ["jpg", "jpeg", "png", "webp"] }],
  });
  if (Array.isArray(result)) return result[0] ?? null;
  return result;
}

export function pickCsvSavePath(defaultPath = "compras.csv"): Promise<string | null> {
  return save({ defaultPath, filters: [{ name: "CSV", extensions: ["csv"] }] });
}

export function onComprasUpdated(cb: (itemId: string | null) => void) {
  return listen<{ itemId: string | null }>("compras://updated", (event) => cb(event.payload?.itemId ?? null));
}

export function onComprasPollStatus(cb: (status: PollStatus) => void) {
  return listen<PollStatus>("compras://poll-status", (event) => cb(event.payload));
}

export function comprasMlStatus(): Promise<MlStatus> {
  return invoke("compras_ml_status");
}

export function comprasMlSaveCredentials(clientId: string, clientSecret: string): Promise<MlStatus> {
  return invoke("compras_ml_save_credentials", { clientId, clientSecret });
}

export function comprasMlClearCredentials(): Promise<MlStatus> {
  return invoke("compras_ml_clear_credentials");
}

// --- Compras: avisos de preço ---

export function comprasGetAlert(itemId: string): Promise<AlertRule | null> {
  return invoke("compras_get_alert", { itemId });
}

/** Saves the rule (target, on/off, new-low) and keeps the item's target in sync. Snooze and last-alert state stay server-side. */
export function comprasSetAlert(rule: AlertRule): Promise<AlertRule> {
  return invoke("compras_set_alert", { rule });
}

/** Sets target = current best price minus `pctBelowCurrent`% for each item that has a price; returns how many were set. */
export function comprasBulkSetTarget(itemIds: string[], pctBelowCurrent: number): Promise<number> {
  return invoke("compras_bulk_set_target", { itemIds, pctBelowCurrent });
}

/** `until` RFC3339, or null to resume alerts. */
export function comprasSnoozeAlert(itemId: string, until: string | null): Promise<AlertRule> {
  return invoke("compras_snooze_alert", { itemId, until });
}

export function comprasListAlertEvents(limit = 100, unseenOnly = false): Promise<AlertEvent[]> {
  return invoke("compras_list_alert_events", { limit, unseenOnly });
}

/** `ids` null = all. Returns how many were marked. */
export function comprasMarkEventsSeen(ids: string[] | null): Promise<number> {
  return invoke("compras_mark_events_seen", { ids });
}

export function comprasTestNotification(): Promise<void> {
  return invoke("compras_test_notification");
}

export function onComprasAlert(cb: (event: AlertEvent) => void) {
  return listen<AlertEvent>("compras://alert", (event) => cb(event.payload));
}
