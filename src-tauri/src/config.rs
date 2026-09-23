use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionRule {
    pub id: String,
    pub name: String,
    /// lowercase, without leading dot (e.g. "png")
    pub extensions: Vec<String>,
    /// absolute destination folder path
    pub destination: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeywordRule {
    pub id: String,
    pub keyword: String,
    /// "contains" | "starts_with" | "exact"
    pub match_type: String,
    /// lowercase, without leading dot. empty = any extension
    pub extensions: Vec<String>,
    /// absolute destination folder path
    pub destination: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Watcher {
    pub id: String,
    pub name: String,
    pub folder: String,
    pub enabled: bool,
    pub extension_rules: Vec<ExtensionRule>,
    pub keyword_rules: Vec<KeywordRule>,
}

/// A folder-scoped rule that takes a destructive/scheduled action instead of
/// reacting to new files: e.g. delete installers older than N days.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionRule {
    pub id: String,
    pub name: String,
    /// id of a Watcher whose folder this rule scans
    pub watcher_id: String,
    /// lowercase, without leading dot. empty = any extension
    pub extensions: Vec<String>,
    pub older_than_days: u32,
    /// "delete" for now, room to grow later
    pub action: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub watchers: Vec<Watcher>,
    #[serde(default)]
    pub action_rules: Vec<ActionRule>,
    pub autostart: bool,
    #[serde(default = "default_scan_interval")]
    pub scan_interval_minutes: u32,
}

fn default_scan_interval() -> u32 {
    60
}

impl Default for AppConfig {
    fn default() -> Self {
        let downloads = default_downloads_dir();
        let images_dest = {
            let mut p = PathBuf::from(&downloads);
            p.push("Imagens");
            p.to_string_lossy().to_string()
        };

        AppConfig {
            watchers: vec![Watcher {
                id: uuid::Uuid::new_v4().to_string(),
                name: "Downloads".to_string(),
                folder: downloads,
                enabled: true,
                extension_rules: vec![ExtensionRule {
                    id: uuid::Uuid::new_v4().to_string(),
                    name: "Imagens".to_string(),
                    extensions: vec![
                        "png".to_string(),
                        "jpg".to_string(),
                        "jpeg".to_string(),
                        "gif".to_string(),
                        "webp".to_string(),
                    ],
                    destination: images_dest,
                    enabled: true,
                }],
                keyword_rules: vec![],
            }],
            action_rules: vec![],
            autostart: false,
            scan_interval_minutes: default_scan_interval(),
        }
    }
}

fn default_downloads_dir() -> String {
    if let Some(home) = std::env::var_os("USERPROFILE") {
        let mut p = PathBuf::from(home);
        p.push("Downloads");
        return p.to_string_lossy().to_string();
    }
    ".".to_string()
}

pub struct ConfigState(pub Mutex<AppConfig>);

fn config_path(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .expect("could not resolve app config dir");
    std::fs::create_dir_all(&dir).ok();
    dir.join("config.json")
}

/// Legacy (single-watcher) shape, kept only to migrate old config files.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyAppConfig {
    watched_folder: String,
    extension_rules: Vec<ExtensionRule>,
    keyword_rules: Vec<KeywordRule>,
    monitoring: bool,
    autostart: bool,
}

impl From<LegacyAppConfig> for AppConfig {
    fn from(legacy: LegacyAppConfig) -> Self {
        AppConfig {
            watchers: vec![Watcher {
                id: uuid::Uuid::new_v4().to_string(),
                name: "Downloads".to_string(),
                folder: legacy.watched_folder,
                enabled: legacy.monitoring,
                extension_rules: legacy.extension_rules,
                keyword_rules: legacy.keyword_rules,
            }],
            action_rules: vec![],
            autostart: legacy.autostart,
            scan_interval_minutes: default_scan_interval(),
        }
    }
}

/// Parses a config file's raw contents, transparently migrating the legacy
/// single-watcher shape when the current shape doesn't match. Pure function,
/// no filesystem access, so it's the seam unit tests hang off of.
fn parse_or_migrate(data: &str) -> Option<AppConfig> {
    if let Ok(cfg) = serde_json::from_str::<AppConfig>(data) {
        return Some(cfg);
    }
    if let Ok(legacy) = serde_json::from_str::<LegacyAppConfig>(data) {
        return Some(legacy.into());
    }
    None
}

pub fn load_config(app: &AppHandle) -> AppConfig {
    let path = config_path(app);
    if let Ok(data) = std::fs::read_to_string(&path) {
        if let Some(cfg) = parse_or_migrate(&data) {
            let _ = save_config(app, &cfg);
            return cfg;
        }
    }
    let cfg = AppConfig::default();
    let _ = save_config(app, &cfg);
    cfg
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_extension_rule() -> ExtensionRule {
        ExtensionRule {
            id: "ext-1".to_string(),
            name: "Imagens".to_string(),
            extensions: vec!["png".to_string(), "jpg".to_string()],
            destination: "C:\\Downloads\\Imagens".to_string(),
            enabled: true,
        }
    }

    fn sample_keyword_rule() -> KeywordRule {
        KeywordRule {
            id: "kw-1".to_string(),
            keyword: "Contrato".to_string(),
            match_type: "contains".to_string(),
            extensions: vec!["pdf".to_string()],
            destination: "C:\\Downloads\\Contrato".to_string(),
            enabled: true,
        }
    }

    #[test]
    fn migrates_legacy_single_watcher_config() {
        let legacy_json = serde_json::json!({
            "watchedFolder": "C:\\Users\\test\\Downloads",
            "extensionRules": [sample_extension_rule()],
            "keywordRules": [sample_keyword_rule()],
            "monitoring": true,
            "autostart": false,
        })
        .to_string();

        let migrated = parse_or_migrate(&legacy_json).expect("should migrate legacy config");

        assert_eq!(migrated.watchers.len(), 1);
        let watcher = &migrated.watchers[0];
        assert_eq!(watcher.folder, "C:\\Users\\test\\Downloads");
        assert!(watcher.enabled);
        assert_eq!(watcher.extension_rules.len(), 1);
        assert_eq!(watcher.keyword_rules.len(), 1);
        assert!(migrated.action_rules.is_empty());
        assert_eq!(migrated.scan_interval_minutes, 60);
    }

    #[test]
    fn migrated_watcher_disabled_when_legacy_monitoring_was_off() {
        let legacy_json = serde_json::json!({
            "watchedFolder": "C:\\Users\\test\\Downloads",
            "extensionRules": [],
            "keywordRules": [],
            "monitoring": false,
            "autostart": false,
        })
        .to_string();

        let migrated = parse_or_migrate(&legacy_json).expect("should migrate legacy config");
        assert!(!migrated.watchers[0].enabled);
    }

    #[test]
    fn new_config_round_trips_through_json() {
        let cfg = AppConfig {
            watchers: vec![
                Watcher {
                    id: "w-1".to_string(),
                    name: "Downloads".to_string(),
                    folder: "C:\\Downloads".to_string(),
                    enabled: true,
                    extension_rules: vec![sample_extension_rule()],
                    keyword_rules: vec![sample_keyword_rule()],
                },
                Watcher {
                    id: "w-2".to_string(),
                    name: "Desktop".to_string(),
                    folder: "C:\\Desktop".to_string(),
                    enabled: false,
                    extension_rules: vec![],
                    keyword_rules: vec![],
                },
            ],
            action_rules: vec![ActionRule {
                id: "a-1".to_string(),
                name: "Limpar instaladores".to_string(),
                watcher_id: "w-1".to_string(),
                extensions: vec!["exe".to_string()],
                older_than_days: 3,
                action: "delete".to_string(),
                enabled: true,
            }],
            autostart: true,
            scan_interval_minutes: 30,
        };

        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("\"watcherId\""), "fields must serialize as camelCase");

        let parsed = parse_or_migrate(&json).expect("round trip should parse directly");
        assert_eq!(parsed.watchers.len(), 2);
        assert_eq!(parsed.action_rules.len(), 1);
        assert_eq!(parsed.scan_interval_minutes, 30);
        assert!(parsed.autostart);
    }
}

pub fn save_config(app: &AppHandle, cfg: &AppConfig) -> std::io::Result<()> {
    let path = config_path(app);
    let data = serde_json::to_string_pretty(cfg)?;
    std::fs::write(path, data)
}
