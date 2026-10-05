mod action_rules;
mod activity;
mod config;
mod git_projects;
mod git_stats;
mod github_auth;
mod github_stats;
mod reminders;
mod scan;
mod vault;
mod watcher;

use activity::ActivityState;
use config::{AppConfig, ConfigState};
use git_projects::{GitProject, GitProjectState};
use git_stats::{ContributorStats, GitProjectStats, GitStatsRange, StatsCacheState};
use reminders::{Reminder, ReminderState};
use scan::ScanResult;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_autostart::ManagerExt;
use vault::{VaultEntry, VaultState};
use watcher::WatcherState;

#[tauri::command]
fn get_config(state: tauri::State<ConfigState>) -> AppConfig {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn save_config(app: AppHandle, config: AppConfig) -> Result<(), String> {
    config::save_config(&app, &config).map_err(|e| e.to_string())?;

    {
        let state = app.state::<ConfigState>();
        *state.0.lock().unwrap() = config.clone();
    }

    let autolaunch = app.autolaunch();
    let _ = if config.autostart {
        autolaunch.enable()
    } else {
        autolaunch.disable()
    };

    watcher::restart_watchers(&app);
    Ok(())
}

#[tauri::command]
fn get_activity(state: tauri::State<ActivityState>) -> Vec<activity::ActivityEntry> {
    state.0.lock().unwrap().iter().cloned().collect()
}

#[tauri::command]
fn clear_activity(state: tauri::State<ActivityState>) {
    state.0.lock().unwrap().clear();
}

#[tauri::command]
fn undo_activity(app: AppHandle, entry_id: String) -> Result<(), String> {
    watcher::undo_move(&app, &entry_id)
}

#[tauri::command]
fn scan_watcher(app: AppHandle, watcher_id: String) -> Result<ScanResult, String> {
    let watcher_cfg = {
        let state = app.state::<ConfigState>();
        let cfg = state.0.lock().unwrap();
        cfg.watchers.iter().find(|w| w.id == watcher_id).cloned()
    };

    let Some(watcher_cfg) = watcher_cfg else {
        return Err("Pasta monitorada não encontrada".to_string());
    };

    scan::scan_folder(&app, &watcher_cfg).map_err(|e| e.to_string())
}

#[tauri::command]
fn run_action_rules_now(app: AppHandle) -> u32 {
    action_rules::run_action_rules(&app)
}

#[tauri::command]
fn get_vault_entries(state: tauri::State<VaultState>) -> Vec<VaultEntry> {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn save_vault_entry(app: AppHandle, entry: VaultEntry) -> Result<VaultEntry, String> {
    let now = chrono::Local::now().to_rfc3339();
    let state = app.state::<VaultState>();
    let saved = {
        let mut entries = state.0.lock().unwrap();
        let saved = vault::upsert_entry(&mut entries, entry, &now);
        vault::save_vault(&app, &entries).map_err(|e| e.to_string())?;
        saved
    };
    Ok(saved)
}

#[tauri::command]
fn delete_vault_entry(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<VaultState>();
    let mut entries = state.0.lock().unwrap();
    vault::remove_entry(&mut entries, &id);
    vault::save_vault(&app, &entries).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_reminders(state: tauri::State<ReminderState>) -> Vec<Reminder> {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn save_reminder(app: AppHandle, reminder: Reminder) -> Result<Reminder, String> {
    let state = app.state::<ReminderState>();
    let saved = {
        let mut reminders = state.0.lock().unwrap();
        let saved = reminders::upsert_reminder(&mut reminders, reminder);
        reminders::save_reminders(&app, &reminders).map_err(|e| e.to_string())?;
        saved
    };
    Ok(saved)
}

#[tauri::command]
fn delete_reminder(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<ReminderState>();
    let mut reminders = state.0.lock().unwrap();
    reminders::remove_reminder(&mut reminders, &id);
    reminders::save_reminders(&app, &reminders).map_err(|e| e.to_string())
}

// --- Bonnie · Repos (git/GitHub stats) ---

#[tauri::command]
fn add_git_project(app: AppHandle, path: String) -> Result<GitProject, String> {
    let draft = git_projects::build_project_from_path(&path)?;
    let state = app.state::<GitProjectState>();
    let mut projects = state.0.lock().unwrap();
    let saved = git_projects::upsert_project(&mut projects, draft);
    git_projects::save_git_projects(&app, &projects).map_err(|e| e.to_string())?;
    Ok(saved)
}

#[tauri::command]
fn list_git_projects(state: tauri::State<GitProjectState>) -> Vec<GitProject> {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn update_git_project(app: AppHandle, project: GitProject) -> Result<GitProject, String> {
    let state = app.state::<GitProjectState>();
    let mut projects = state.0.lock().unwrap();
    let saved = git_projects::upsert_project(&mut projects, project);
    git_projects::save_git_projects(&app, &projects).map_err(|e| e.to_string())?;
    Ok(saved)
}

#[tauri::command]
fn remove_git_project(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<GitProjectState>();
    let mut projects = state.0.lock().unwrap();
    git_projects::remove_project(&mut projects, &id);
    git_projects::save_git_projects(&app, &projects).map_err(|e| e.to_string())
}

/// Replaces local contributors with GitHub's official per-contributor stats
/// when available (richer: real login + avatar, computed server-side).
/// Falls back to the local-only breakdown when the repo has no GitHub
/// remote/token, or when GitHub's stats endpoint fails (Business Rule #5).
fn merge_contributors(
    local: Vec<ContributorStats>,
    remote: Vec<ContributorStats>,
    me_login: &str,
) -> Vec<ContributorStats> {
    if remote.is_empty() {
        return local;
    }
    remote
        .into_iter()
        .map(|mut c| {
            c.is_me = c.login.eq_ignore_ascii_case(me_login);
            c
        })
        .collect()
}

async fn compute_git_stats(
    app: AppHandle,
    project_id: String,
    range: GitStatsRange,
    force_refresh: bool,
) -> Result<GitProjectStats, String> {
    let cache_state = app.state::<StatsCacheState>();
    if !force_refresh {
        if let Some(cached) = git_stats::cache_get(&cache_state, &project_id, &range) {
            return Ok(cached);
        }
    }

    let project = {
        let state = app.state::<GitProjectState>();
        let projects = state.0.lock().unwrap();
        projects.iter().find(|p| p.id == project_id).cloned()
    };
    let Some(project) = project else {
        return Err("Projeto não encontrado".to_string());
    };

    let token = github_auth::load_token()?;
    let cached_login = github_auth::load_login(&app);

    let range_for_task = range.clone();
    let stats = tauri::async_runtime::spawn_blocking(move || -> Result<GitProjectStats, String> {
        if !std::path::Path::new(&project.local_path).is_dir() {
            return Err(format!("Pasta do projeto não encontrada: {}", project.local_path));
        }

        let raw = git_stats::run_git_log(&project.local_path, &range_for_task)?;
        let (local, mut contributors) = git_stats::parse_git_log_output(&raw, &project.my_emails);
        let mut github = None;
        let mut github_error = None;

        if let (Some(token), Some(owner), Some(repo)) =
            (&token, &project.github_owner, &project.github_repo)
        {
            let login = match cached_login.clone() {
                Some(l) => Some(l),
                None => match github_stats::fetch_authenticated_user(token) {
                    Ok(l) => Some(l),
                    Err(e) => {
                        github_error = Some(e);
                        None
                    }
                },
            };

            if let Some(login) = login {
                match github_stats::fetch_github_stats(token, owner, repo, &login, &range_for_task) {
                    Ok(gh) => github = Some(gh),
                    Err(e) => github_error = Some(e),
                }
                match github_stats::fetch_contributor_stats(token, owner, repo) {
                    Ok(remote_contributors) => {
                        contributors = merge_contributors(contributors, remote_contributors, &login);
                    }
                    Err(e) => {
                        github_error.get_or_insert(e);
                    }
                };
            }
            // Whatever failed, `github` stays None and `contributors` stays
            // local-only — Business Rule #5, never fail the whole command
            // over the GitHub half of the data. `github_error` carries the
            // reason so the UI can explain the gap instead of going silent.
        }

        Ok(GitProjectStats {
            local,
            github,
            github_error,
            contributors,
            range: range_for_task,
            fetched_at: chrono::Local::now().to_rfc3339(),
            from_cache: false,
        })
    })
    .await
    .map_err(|e| e.to_string())??;

    git_stats::cache_put(&cache_state, &project_id, &range, stats.clone());
    Ok(stats)
}

#[tauri::command]
async fn get_git_stats(app: AppHandle, project_id: String, range: GitStatsRange) -> Result<GitProjectStats, String> {
    compute_git_stats(app, project_id, range, false).await
}

#[tauri::command]
async fn refresh_git_stats(app: AppHandle, project_id: String, range: GitStatsRange) -> Result<GitProjectStats, String> {
    compute_git_stats(app, project_id, range, true).await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GithubTokenStatus {
    configured: bool,
    login: Option<String>,
}

#[tauri::command]
fn get_github_token_status(app: AppHandle) -> Result<GithubTokenStatus, String> {
    let configured = github_auth::load_token()?.is_some();
    let login = if configured { github_auth::load_login(&app) } else { None };
    Ok(GithubTokenStatus { configured, login })
}

#[tauri::command]
async fn save_github_token(app: AppHandle, token: String) -> Result<GithubTokenStatus, String> {
    let token_for_task = token.clone();
    let login = tauri::async_runtime::spawn_blocking(move || github_stats::fetch_authenticated_user(&token_for_task))
        .await
        .map_err(|e| e.to_string())??;

    github_auth::save_token(&token)?;
    github_auth::save_login(&app, &login);
    Ok(GithubTokenStatus { configured: true, login: Some(login) })
}

#[tauri::command]
fn clear_github_token(app: AppHandle) -> Result<(), String> {
    github_auth::clear_token()?;
    github_auth::clear_login(&app);
    Ok(())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            get_activity,
            clear_activity,
            undo_activity,
            scan_watcher,
            run_action_rules_now,
            get_vault_entries,
            save_vault_entry,
            delete_vault_entry,
            get_reminders,
            save_reminder,
            delete_reminder,
            add_git_project,
            list_git_projects,
            update_git_project,
            remove_git_project,
            get_git_stats,
            refresh_git_stats,
            get_github_token_status,
            save_github_token,
            clear_github_token,
            quit_app,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            let cfg = config::load_config(&handle);
            app.manage(ConfigState(Mutex::new(cfg)));
            app.manage(ActivityState(Mutex::new(VecDeque::new())));
            app.manage(WatcherState(Mutex::new(HashMap::new())));

            let vault_entries = vault::load_vault(&handle);
            app.manage(VaultState(Mutex::new(vault_entries)));

            let reminders = reminders::load_reminders(&handle);
            app.manage(ReminderState(Mutex::new(reminders)));

            let git_projects = git_projects::load_git_projects(&handle);
            app.manage(GitProjectState(Mutex::new(git_projects)));
            app.manage(StatsCacheState(Mutex::new(HashMap::new())));

            build_tray(app)?;

            if let Some(window) = app.get_webview_window("main") {
                let launched_minimized = std::env::args().any(|a| a == "--minimized");
                if launched_minimized {
                    let _ = window.hide();
                }

                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_clone.hide();
                    }
                });
            }

            watcher::restart_watchers(&handle);
            spawn_action_rules_ticker(handle.clone());
            spawn_reminders_ticker(handle);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Runs action rules immediately on startup, then keeps re-running them on
/// the interval from config (re-read every cycle so a saved config change
/// takes effect on the following tick without restarting the app).
fn spawn_action_rules_ticker(app: AppHandle) {
    std::thread::spawn(move || loop {
        action_rules::run_action_rules(&app);

        let interval_minutes = {
            let state = app.state::<ConfigState>();
            let minutes = state.0.lock().unwrap().scan_interval_minutes;
            minutes
        };
        let interval_minutes = interval_minutes.max(1);
        std::thread::sleep(Duration::from_secs(u64::from(interval_minutes) * 60));
    });
}

/// Reminders need minute-level precision (unlike the hourly action-rule
/// sweep), so they get their own fast ticker.
fn spawn_reminders_ticker(app: AppHandle) {
    std::thread::spawn(move || loop {
        reminders::run_reminder_check(&app);
        std::thread::sleep(Duration::from_secs(30));
    });
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "Abrir", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Tonho Assistants")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
