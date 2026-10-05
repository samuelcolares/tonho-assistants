import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { check as checkForUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type {
  ActivityEntry,
  AppConfig,
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
