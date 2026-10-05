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

// --- Bonnie · Repos (git/GitHub stats) ---

export interface GitProject {
  id: string;
  name: string;
  localPath: string;
  githubOwner?: string | null;
  githubRepo?: string | null;
  myEmails: string[];
  enabled: boolean;
}

export interface GitStatsRange {
  since: string;
  until: string;
}

export type RangePreset = "30" | "45" | "60" | "90" | "custom";

export interface CommitsByDay {
  date: string;
  count: number;
}

export interface FileChurn {
  path: string;
  changes: number;
}

export interface LocalGitStats {
  commitCount: number;
  additions: number;
  deletions: number;
  commitsByDay: CommitsByDay[];
  topFiles: FileChurn[];
}

export interface ContributorStats {
  login: string;
  avatarUrl?: string | null;
  commitCount: number;
  additions: number;
  deletions: number;
  isMe: boolean;
}

export interface GithubStats {
  totalPrsAuthored: number;
  openPrsAuthored: number;
  mergedPrsAuthoredInRange: number;
  closedUnmergedInRange: number;
  avgTimeToMergeHours?: number | null;
  reviewsGivenInRange: number;
  issuesOpenedInRange: number;
  issuesClosedInRange: number;
}

export interface GitProjectStats {
  local: LocalGitStats;
  github?: GithubStats | null;
  githubError?: string | null;
  contributors: ContributorStats[];
  range: GitStatsRange;
  fetchedAt: string;
  fromCache: boolean;
}

export interface GithubTokenStatus {
  configured: boolean;
  login?: string | null;
}
