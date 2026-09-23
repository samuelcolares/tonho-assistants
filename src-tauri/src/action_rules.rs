use crate::activity::{push_activity, ActivityEntry};
use crate::config::{ActionRule, ConfigState};
use crate::watcher::extension_of;
use std::path::Path;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Manager};

/// Pure eligibility check: does `path` match `rule`'s extension filter and
/// is it older than `rule.older_than_days`, as of `now`? Uses the file's
/// last-modified time as the "downloaded at" signal, since it's reliable
/// across filesystems and easy to control in tests (unlike creation time,
/// which isn't uniformly settable on all platforms).
pub fn is_eligible(path: &Path, rule: &ActionRule, now: SystemTime) -> bool {
    if !rule.enabled {
        return false;
    }

    let ext = extension_of(path);
    if !rule.extensions.is_empty() && !rule.extensions.contains(&ext) {
        return false;
    }

    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    let Ok(modified) = meta.modified() else {
        return false;
    };
    let Ok(age) = now.duration_since(modified) else {
        return false;
    };

    let threshold = Duration::from_secs(u64::from(rule.older_than_days) * 24 * 60 * 60);
    age >= threshold
}

/// Runs every enabled action rule once: scans its target watcher's folder
/// (non-recursive) and deletes matching files. Returns how many were deleted.
pub fn run_action_rules(app: &AppHandle) -> u32 {
    let (action_rules, watchers) = {
        let cfg_state = app.state::<ConfigState>();
        let cfg = cfg_state.0.lock().unwrap();
        (cfg.action_rules.clone(), cfg.watchers.clone())
    };

    let now = SystemTime::now();
    let mut deleted_count = 0u32;

    for rule in action_rules.iter().filter(|r| r.enabled) {
        let Some(watcher) = watchers.iter().find(|w| w.id == rule.watcher_id) else {
            continue;
        };
        let Ok(entries) = std::fs::read_dir(&watcher.folder) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() || !is_eligible(&path, rule, now) {
                continue;
            }

            let file_name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let from = path.to_string_lossy().to_string();

            match std::fs::remove_file(&path) {
                Ok(_) => {
                    deleted_count += 1;
                    push_activity(app, ActivityEntry::deleted(file_name, from, rule.name.clone()));
                }
                Err(e) => {
                    push_activity(app, ActivityEntry::error(file_name, from, e.to_string()));
                }
            }
        }
    }

    deleted_count
}

#[cfg(test)]
mod tests {
    use super::*;
    use filetime::{set_file_mtime, FileTime};

    fn sample_rule(older_than_days: u32, extensions: Vec<&str>) -> ActionRule {
        ActionRule {
            id: "a1".to_string(),
            name: "Limpar instaladores".to_string(),
            watcher_id: "w1".to_string(),
            extensions: extensions.into_iter().map(String::from).collect(),
            older_than_days,
            action: "delete".to_string(),
            enabled: true,
        }
    }

    fn touch_with_age(path: &Path, days_old: u64) {
        std::fs::write(path, b"data").unwrap();
        let past = SystemTime::now() - Duration::from_secs(days_old * 24 * 60 * 60);
        set_file_mtime(path, FileTime::from_system_time(past)).unwrap();
    }

    #[test]
    fn eligible_when_older_than_threshold() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("installer.exe");
        touch_with_age(&file, 5);

        let rule = sample_rule(3, vec!["exe"]);
        assert!(is_eligible(&file, &rule, SystemTime::now()));
    }

    #[test]
    fn not_eligible_when_younger_than_threshold() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("installer.exe");
        touch_with_age(&file, 1);

        let rule = sample_rule(3, vec!["exe"]);
        assert!(!is_eligible(&file, &rule, SystemTime::now()));
    }

    #[test]
    fn respects_extension_filter() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("notes.txt");
        touch_with_age(&file, 10);

        let rule = sample_rule(3, vec!["exe"]);
        assert!(!is_eligible(&file, &rule, SystemTime::now()));
    }

    #[test]
    fn empty_extension_list_matches_any_file() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("notes.txt");
        touch_with_age(&file, 10);

        let rule = sample_rule(3, vec![]);
        assert!(is_eligible(&file, &rule, SystemTime::now()));
    }

    #[test]
    fn disabled_rule_is_never_eligible() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("installer.exe");
        touch_with_age(&file, 30);

        let mut rule = sample_rule(3, vec!["exe"]);
        rule.enabled = false;
        assert!(!is_eligible(&file, &rule, SystemTime::now()));
    }
}
