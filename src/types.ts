export interface ExtensionRule {
  id: string;
  name: string;
  extensions: string[];
  destination: string;
  enabled: boolean;
}

export type KeywordMatchType = "contains" | "starts_with" | "exact";

export interface KeywordRule {
  id: string;
  keyword: string;
  matchType: KeywordMatchType;
  extensions: string[];
  destination: string;
  enabled: boolean;
}

export interface WatcherConfig {
  id: string;
  name: string;
  folder: string;
  enabled: boolean;
  extensionRules: ExtensionRule[];
  keywordRules: KeywordRule[];
}

export interface ActionRule {
  id: string;
  name: string;
  watcherId: string;
  extensions: string[];
  olderThanDays: number;
  action: "delete";
  enabled: boolean;
}

export interface AppConfig {
  watchers: WatcherConfig[];
  actionRules: ActionRule[];
  autostart: boolean;
  scanIntervalMinutes: number;
}

export interface ActivityEntry {
  id: string;
  timestamp: string;
  fileName: string;
  from: string;
  to?: string | null;
  ruleName?: string | null;
  status: "moved" | "error" | "deleted";
  message?: string | null;
}

export interface ScanResult {
  moved: number;
  skipped: number;
}

export interface VaultEntry {
  id: string;
  label: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export type ReminderRepeat = "none" | "daily" | "weekly" | "monthly" | "yearly";

export interface Reminder {
  id: string;
  title: string;
  notes: string;
  dueAt: string;
  repeat: ReminderRepeat;
  done: boolean;
  notifiedAt?: string | null;
}
