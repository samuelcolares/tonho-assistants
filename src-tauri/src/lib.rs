mod action_rules;
mod activity;
mod config;
mod reminders;
mod scan;
mod vault;
mod watcher;

use activity::ActivityState;
use config::{AppConfig, ConfigState};
use reminders::{Reminder, ReminderState};
use scan::ScanResult;
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
