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

// --- Compras para Casa (price tracker) ---

export type OfferAdapter = "generic" | "kabum" | "amazon" | "vtex" | "mercadolivre" | "manual";

export interface MlStatus { configured: boolean; clientId: string | null; }
export type OfferStatus = "pending" | "ok" | "manual" | "suspect" | "blocked" | "broken" | "paused";
export type SpecKind = "text" | "number" | "bool" | "enum";

export interface SpecField {
  key: string;
  label: string;
  kind: SpecKind;
  options?: string[] | null;
  unit?: string | null;
}
export interface CategoryTemplate {
  id: string;
  name: string;
  fields: SpecField[];
}

export interface ComprasItem {
  id: string; // "" on create
  category: string;
  name: string;
  qty: number;
  budgetUnitCents: number | null;
  targetCents: number | null;
  notes: string;
  bought: boolean;
  imagePath: string | null;
  specs: Record<string, string>;
  templateId: string | null;
  modelToken: string | null;
  priority: number; // 0 normal, 1 high
  createdAt: string;
  updatedAt: string;
}

export interface ComprasOffer {
  id: string;
  itemId: string;
  store: string;
  url: string | null;
  title: string | null;
  sku: string | null;
  adapter: OfferAdapter;
  shippingCents: number | null;
  shippingNote: string | null;
  pixDiscountPct: number | null;
  status: OfferStatus;
  failCount: number;
  lastError: string | null;
  lastCheckedAt: string | null;
  nextPollAt: string | null;
  createdAt: string;
}

export interface ComprasObservation {
  id: string;
  offerId: string;
  listCents: number | null;
  cashCents: number | null;
  installmentsText: string | null;
  inStock: boolean | null;
  source: "auto" | "manual";
  confirmed: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  error: string | null;
}

export interface ComprasPurchase {
  itemId: string;
  paidUnitCents: number;
  shippingCents: number;
  store: string;
  purchasedAt: string;
  notes: string;
}

export interface OfferView extends ComprasOffer {
  latest: ComprasObservation | null;
  effectiveCashCents: number | null;
  cashSource: "page" | "estimated" | "list" | null;
  finalCents: number | null;
  shippingKnown: boolean;
}

export interface ItemStats {
  windowDays: number;
  samples: number;
  minCents: number | null;
  maxCents: number | null;
  meanCents: number | null;
  medianCents: number | null;
  trimmedMeanCents: number | null;
  p25Cents: number | null;
  p75Cents: number | null;
  allTimeLowCents: number | null;
  currentFinalCents: number | null;
  isHistoricalLow: boolean;
  belowTarget: boolean;
  aboveMedian: boolean;
  trend: "down" | "up" | "flat" | null;
}

export interface ItemView {
  item: ComprasItem;
  imageFile: string | null;
  offers: OfferView[];
  best: OfferView | null;
  stats: ItemStats;
  purchase: ComprasPurchase | null;
  alert: AlertRule | null;
}

export interface CategoryBudget {
  category: string;
  budgetCents: number;
  boughtCents: number;
  currentCents: number;
}
export interface BudgetSummary {
  totalBudgetCents: number;
  boughtCents: number;
  remainingBudgetCents: number;
  remainingAtCurrentCents: number;
  pricedItems: number;
  pctDone: number;
  itemsTotal: number;
  itemsBought: number;
  byCategory: CategoryBudget[];
}

export interface HistoryPoint {
  date: string;
  bestFinalCents: number | null;
  perOffer: Record<string, number | null>;
}

export interface Extracted {
  url: string;
  store: string;
  adapter: OfferAdapter;
  title: string | null;
  imageUrl: string | null;
  listCents: number | null;
  cashCents: number | null;
  installmentsText: string | null;
  inStock: boolean | null;
  sku: string | null;
  blocked: boolean;
  warnings: string[];
}

export interface ImportReport {
  inserted: number;
  updated: number;
  skipped: number;
  boughtImported: number;
  totalBudgetCents: number;
  boughtCents: number;
  remainingBudgetCents: number;
  errors: string[];
}

export interface ComprasSettings {
  pollEnabled: boolean;
  pollIntervalMinutes: number;
  amazonMinIntervalMinutes: number;
  cep: string | null;
  pixDiscountByStore: Record<string, number>;
  notifyEnabled: boolean;
  notifyNewLow: boolean;
  cooldownHours: number;
  realertDropPct: number;
  quietStart: string | null; // "HH:MM"; null (with quietEnd) = off
  quietEnd: string | null;
  maxToastsPerCycle: number;
  includeShipping: boolean;
  usePix: boolean;
  defaultTargetPct: number;
  rooms: string[];
}

export type AlertKind = "target" | "new_low" | "restock";

/** Per-item alert rule. `targetCents` mirrors `ComprasItem.targetCents`. Backend owns snooze and last_alert_*. */
export interface AlertRule {
  itemId: string;
  enabled: boolean;
  targetCents: number | null;
  notifyNewLow: boolean;
  snoozeUntil: string | null;
  lastAlertCents: number | null;
  lastAlertAt: string | null;
  updatedAt: string;
}

export interface AlertEvent {
  id: string;
  itemId: string;
  offerId: string | null;
  kind: AlertKind;
  priceCents: number;
  prevCents: number | null;
  reason: string;
  createdAt: string;
  /** Held by quiet hours; delivered later by the ticker. */
  pending: boolean;
  seen: boolean;
  deliveredDesktop: boolean;
  deliveredDiscord: boolean;
  itemName: string;
  title: string;
}

export interface PollStatus {
  running: boolean;
  queued: number;
  lastRunAt: string | null;
}
