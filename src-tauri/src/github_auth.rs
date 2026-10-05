//! GitHub token storage. Unlike every other persisted entity in this app
//! (vault, reminders, git_projects — all plain JSON files under the app's
//! config dir), a GitHub PAT is a real secret: it's stored in the OS
//! credential store via `keyring`, never written to disk in plain text.
//!
//! The authenticated login is NOT a secret, so it's cached alongside in a
//! tiny plain JSON file — that avoids an API round trip every time the UI
//! just wants to show "Conectado como @login" without re-validating.

use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const SERVICE: &str = "com.krieg.fileorganizer";
const USERNAME: &str = "github-pat";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, USERNAME).map_err(|e| e.to_string())
}

pub fn save_token(token: &str) -> Result<(), String> {
    entry()?.set_password(token).map_err(|e| e.to_string())
}

/// Returns `Ok(None)` when no token has been saved yet — that's a normal
/// "not connected" state, not an error. Returns `Err` only for genuine
/// keyring access failures (e.g. credential store unavailable).
pub fn load_token() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn clear_token() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedLogin {
    login: String,
}

fn login_cache_path(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .expect("could not resolve app config dir");
    std::fs::create_dir_all(&dir).ok();
    dir.join("github_login.json")
}

pub fn save_login(app: &AppHandle, login: &str) {
    let path = login_cache_path(app);
    let data = serde_json::to_string(&CachedLogin { login: login.to_string() }).unwrap_or_default();
    let _ = std::fs::write(path, data);
}

pub fn load_login(app: &AppHandle) -> Option<String> {
    let path = login_cache_path(app);
    let data = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<CachedLogin>(&data).ok().map(|c| c.login)
}

pub fn clear_login(app: &AppHandle) {
    let _ = std::fs::remove_file(login_cache_path(app));
}
