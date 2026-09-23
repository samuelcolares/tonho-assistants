use crate::activity::{push_activity, ActivityEntry, ActivityState};
use crate::config::{ConfigState, Watcher};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher as NotifyWatcher};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub struct WatcherState(pub Mutex<HashMap<String, RecommendedWatcher>>);

pub const IGNORED_EXTENSIONS: &[&str] = &["crdownload", "tmp", "part", "download", "partial"];
const STABLE_CHECKS_REQUIRED: u32 = 2;
const STABLE_CHECK_INTERVAL_MS: u64 = 350;
const STABLE_CHECK_MAX_ATTEMPTS: u32 = 40; // ~14s max wait

/// Tears down every active filesystem watcher and rebuilds one per enabled
/// Watcher entry in the current config. Safe to call any time config changes.
pub fn restart_watchers(app: &AppHandle) {
    let watcher_state = app.state::<WatcherState>();
    {
        let mut guard = watcher_state.0.lock().unwrap();
        guard.clear();
    }

    let watchers = {
        let cfg_state = app.state::<ConfigState>();
        let watchers = cfg_state.0.lock().unwrap().watchers.clone();
        watchers
    };

    for watcher_cfg in watchers.into_iter().filter(|w| w.enabled) {
        start_single_watcher(app, watcher_cfg);
    }
}

fn start_single_watcher(app: &AppHandle, watcher_cfg: Watcher) {
    let watch_path = PathBuf::from(&watcher_cfg.folder);
    if !watch_path.is_dir() {
        let _ = app.emit(
            "watcher-error",
            format!("Pasta não encontrada: {} ({})", watcher_cfg.folder, watcher_cfg.name),
        );
        return;
    }

    let app_handle = app.clone();
    let watcher_id = watcher_cfg.id.clone();
    let watched_dir = watch_path.clone();
    let in_progress: Arc<Mutex<HashSet<PathBuf>>> = Arc::new(Mutex::new(HashSet::new()));

    let watcher_result = notify::recommended_watcher(move |res: notify::Result<Event>| {
        let event = match res {
            Ok(e) => e,
            Err(_) => return,
        };

        if !matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_)) {
            return;
        }

        for path in event.paths.clone() {
            if path.parent() != Some(watched_dir.as_path()) {
                continue;
            }

            let app_clone = app_handle.clone();
            let in_progress_clone = Arc::clone(&in_progress);
            let watcher_id_clone = watcher_id.clone();
            queue_file(app_clone, watcher_id_clone, path, in_progress_clone);
        }
    });

    match watcher_result {
        Ok(mut watcher) => {
            if let Err(e) = watcher.watch(&watch_path, RecursiveMode::NonRecursive) {
                let _ = app.emit(
                    "watcher-error",
                    format!("Falha ao observar pasta {}: {}", watcher_cfg.name, e),
                );
                return;
            }
            let watcher_state = app.state::<WatcherState>();
            let mut guard = watcher_state.0.lock().unwrap();
            guard.insert(watcher_cfg.id.clone(), watcher);
            let _ = app.emit("watcher-status", "running");
        }
        Err(e) => {
            let _ = app.emit("watcher-error", format!("Falha ao criar watcher: {}", e));
        }
    }
}

fn queue_file(
    app: AppHandle,
    watcher_id: String,
    path: PathBuf,
    in_progress: Arc<Mutex<HashSet<PathBuf>>>,
) {
    {
        let mut guard = in_progress.lock().unwrap();
        if guard.contains(&path) {
            return;
        }
        guard.insert(path.clone());
    }

    std::thread::spawn(move || {
        process_new_file(&app, &watcher_id, &path);
        in_progress.lock().unwrap().remove(&path);
    });
}

fn process_new_file(app: &AppHandle, watcher_id: &str, path: &Path) {
    let ext = extension_of(path);
    if IGNORED_EXTENSIONS.contains(&ext.as_str()) {
        return;
    }

    if !wait_until_stable(path) {
        return;
    }

    let watcher_cfg = {
        let cfg_state = app.state::<ConfigState>();
        let cfg = cfg_state.0.lock().unwrap();
        cfg.watchers.iter().find(|w| w.id == watcher_id).cloned()
    };

    let Some(watcher_cfg) = watcher_cfg else {
        return;
    };

    apply_and_log(app, path, &watcher_cfg);
}

pub fn extension_of(path: &Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn wait_until_stable(path: &Path) -> bool {
    let mut last_size: Option<u64> = None;
    let mut stable_count = 0u32;

    for _ in 0..STABLE_CHECK_MAX_ATTEMPTS {
        let meta = match std::fs::metadata(path) {
            Ok(m) => m,
            Err(_) => return false,
        };
        let size = meta.len();

        if Some(size) == last_size {
            stable_count += 1;
            if stable_count >= STABLE_CHECKS_REQUIRED {
                return true;
            }
        } else {
            stable_count = 0;
            last_size = Some(size);
        }

        std::thread::sleep(Duration::from_millis(STABLE_CHECK_INTERVAL_MS));
    }

    path.exists()
}

/// Returns (destination_folder, rule_name) for the first matching rule.
/// Keyword rules take priority over plain extension rules.
pub fn find_matching_rule(path: &Path, watcher: &Watcher) -> Option<(PathBuf, String)> {
    let ext = extension_of(path);
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    for rule in &watcher.keyword_rules {
        if !rule.enabled || rule.keyword.trim().is_empty() {
            continue;
        }
        if !rule.extensions.is_empty() && !rule.extensions.contains(&ext) {
            continue;
        }
        let keyword = rule.keyword.to_lowercase();
        let matches = match rule.match_type.as_str() {
            "starts_with" => stem.starts_with(&keyword),
            "exact" => stem == keyword,
            _ => stem.contains(&keyword),
        };
        if matches {
            return Some((PathBuf::from(&rule.destination), rule.keyword.clone()));
        }
    }

    for rule in &watcher.extension_rules {
        if !rule.enabled {
            continue;
        }
        if rule.extensions.contains(&ext) {
            return Some((PathBuf::from(&rule.destination), rule.name.clone()));
        }
    }

    None
}

/// Outcome of trying to apply a watcher's rules to one file. Pure (no
/// AppHandle involved) so it can be exercised directly in unit tests.
pub enum RuleOutcome {
    Moved {
        file_name: String,
        from: String,
        to: String,
        rule_name: String,
    },
    Failed {
        file_name: String,
        from: String,
        message: String,
    },
}

/// Finds the first matching rule for `path` and performs the move on disk.
/// Returns `None` when no rule matches (file is left untouched).
pub fn try_apply_rule(path: &Path, watcher: &Watcher) -> Option<RuleOutcome> {
    let (destination, rule_name) = find_matching_rule(path, watcher)?;

    let from = path.to_string_lossy().to_string();
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    Some(match move_file(path, &destination) {
        Ok(final_dest) => RuleOutcome::Moved {
            file_name,
            from,
            to: final_dest.to_string_lossy().to_string(),
            rule_name,
        },
        Err(e) => RuleOutcome::Failed {
            file_name,
            from,
            message: e.to_string(),
        },
    })
}

/// Applies the first matching rule to `path` (if any) and logs the outcome.
/// Shared by the live watcher and the manual "scan now" command.
pub fn apply_and_log(app: &AppHandle, path: &Path, watcher: &Watcher) -> bool {
    match try_apply_rule(path, watcher) {
        None => false,
        Some(RuleOutcome::Moved {
            file_name,
            from,
            to,
            rule_name,
        }) => {
            push_activity(app, ActivityEntry::moved(file_name, from, to, rule_name));
            true
        }
        Some(RuleOutcome::Failed {
            file_name,
            from,
            message,
        }) => {
            push_activity(app, ActivityEntry::error(file_name, from, message));
            false
        }
    }
}

/// Reverses a previously logged "moved" activity entry: moves the file from
/// its current (`to`) location back into the folder it originally came from.
/// If that folder already has a same-named file, the restored copy gets a
/// " (1)"-style suffix rather than overwriting anything.
pub fn undo_move(app: &AppHandle, entry_id: &str) -> Result<(), String> {
    let entry = {
        let state = app.state::<ActivityState>();
        let log = state.0.lock().unwrap();
        log.iter().find(|e| e.id == entry_id).cloned()
    };

    let Some(entry) = entry else {
        return Err("Registro de atividade não encontrado".to_string());
    };
    if entry.status != "moved" {
        return Err("Só é possível desfazer movimentações de arquivo".to_string());
    }
    let Some(to) = entry.to.clone() else {
        return Err("Registro de atividade inválido".to_string());
    };

    let to_path = PathBuf::from(&to);
    let original_parent = PathBuf::from(&entry.from)
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or("Caminho original inválido")?;

    match move_file(&to_path, &original_parent) {
        Ok(final_dest) => {
            push_activity(
                app,
                ActivityEntry::moved(
                    entry.file_name.clone(),
                    to,
                    final_dest.to_string_lossy().to_string(),
                    "Desfazer".to_string(),
                ),
            );
            Ok(())
        }
        Err(e) => Err(e.to_string()),
    }
}

fn move_file(src: &Path, dest_dir: &Path) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(dest_dir)?;
    let dest = unique_destination(dest_dir, src.file_name().unwrap());

    if std::fs::rename(src, &dest).is_ok() {
        return Ok(dest);
    }

    // Cross-device (different drive) move: fall back to copy + delete.
    std::fs::copy(src, &dest)?;
    std::fs::remove_file(src)?;
    Ok(dest)
}

fn unique_destination(dir: &Path, file_name: &std::ffi::OsStr) -> PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }

    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let ext = path.extension().map(|e| e.to_string_lossy().to_string());

    for i in 1..10_000 {
        let new_name = match &ext {
            Some(ext) => format!("{} ({}).{}", stem, i, ext),
            None => format!("{} ({})", stem, i),
        };
        let candidate = dir.join(new_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    dir.join(file_name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ExtensionRule;
    use crate::config::KeywordRule;

    fn watcher_with(
        folder: &Path,
        extension_rules: Vec<ExtensionRule>,
        keyword_rules: Vec<KeywordRule>,
    ) -> Watcher {
        Watcher {
            id: "w-test".to_string(),
            name: "Test".to_string(),
            folder: folder.to_string_lossy().to_string(),
            enabled: true,
            extension_rules,
            keyword_rules,
        }
    }

    #[test]
    fn moves_file_matching_extension_rule() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("Imagens");
        let src = tmp.path().join("foto.png");
        std::fs::write(&src, b"fake image").unwrap();

        let watcher = watcher_with(
            tmp.path(),
            vec![ExtensionRule {
                id: "e1".to_string(),
                name: "Imagens".to_string(),
                extensions: vec!["png".to_string()],
                destination: dest.to_string_lossy().to_string(),
                enabled: true,
            }],
            vec![],
        );

        let outcome = try_apply_rule(&src, &watcher).expect("rule should match");
        match outcome {
            RuleOutcome::Moved { to, rule_name, .. } => {
                assert_eq!(rule_name, "Imagens");
                assert!(Path::new(&to).exists());
            }
            RuleOutcome::Failed { message, .. } => panic!("unexpected failure: {message}"),
        }
        assert!(!src.exists());
    }

    #[test]
    fn keyword_rule_takes_priority_over_extension_rule() {
        let tmp = tempfile::tempdir().unwrap();
        let ext_dest = tmp.path().join("PDFs");
        let kw_dest = tmp.path().join("Contrato");
        let src = tmp.path().join("Contrato_Aluguel.pdf");
        std::fs::write(&src, b"fake pdf").unwrap();

        let watcher = watcher_with(
            tmp.path(),
            vec![ExtensionRule {
                id: "e1".to_string(),
                name: "PDFs".to_string(),
                extensions: vec!["pdf".to_string()],
                destination: ext_dest.to_string_lossy().to_string(),
                enabled: true,
            }],
            vec![KeywordRule {
                id: "k1".to_string(),
                keyword: "Contrato".to_string(),
                match_type: "contains".to_string(),
                extensions: vec!["pdf".to_string()],
                destination: kw_dest.to_string_lossy().to_string(),
                enabled: true,
            }],
        );

        let outcome = try_apply_rule(&src, &watcher).expect("rule should match");
        match outcome {
            RuleOutcome::Moved { to, .. } => {
                assert!(to.starts_with(&kw_dest.to_string_lossy().to_string()));
            }
            RuleOutcome::Failed { message, .. } => panic!("unexpected failure: {message}"),
        }
    }

    #[test]
    fn returns_none_when_no_rule_matches() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("random.txt");
        std::fs::write(&src, b"text").unwrap();

        let watcher = watcher_with(tmp.path(), vec![], vec![]);
        assert!(try_apply_rule(&src, &watcher).is_none());
        assert!(src.exists());
    }

    #[test]
    fn disabled_rule_is_ignored() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("Imagens");
        let src = tmp.path().join("foto.png");
        std::fs::write(&src, b"fake image").unwrap();

        let watcher = watcher_with(
            tmp.path(),
            vec![ExtensionRule {
                id: "e1".to_string(),
                name: "Imagens".to_string(),
                extensions: vec!["png".to_string()],
                destination: dest.to_string_lossy().to_string(),
                enabled: false,
            }],
            vec![],
        );

        assert!(try_apply_rule(&src, &watcher).is_none());
    }
}
