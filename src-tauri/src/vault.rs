use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntry {
    pub id: String,
    pub label: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

pub struct VaultState(pub Mutex<Vec<VaultEntry>>);

fn vault_path(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .expect("could not resolve app config dir");
    std::fs::create_dir_all(&dir).ok();
    dir.join("vault.json")
}

pub fn load_vault(app: &AppHandle) -> Vec<VaultEntry> {
    let path = vault_path(app);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|data| serde_json::from_str(&data).ok())
        .unwrap_or_default()
}

pub fn save_vault(app: &AppHandle, entries: &[VaultEntry]) -> std::io::Result<()> {
    let path = vault_path(app);
    let data = serde_json::to_string_pretty(entries)?;
    std::fs::write(path, data)
}

/// Inserts a brand-new entry (empty/unknown id) or replaces an existing one
/// by id, refreshing `updated_at`. Pure — the seam unit tests hang off of.
pub fn upsert_entry(entries: &mut Vec<VaultEntry>, mut entry: VaultEntry, now: &str) -> VaultEntry {
    entry.updated_at = now.to_string();

    if entry.id.trim().is_empty() {
        entry.id = uuid::Uuid::new_v4().to_string();
        entry.created_at = now.to_string();
        entries.push(entry.clone());
        return entry;
    }

    if let Some(existing) = entries.iter_mut().find(|e| e.id == entry.id) {
        entry.created_at = existing.created_at.clone();
        *existing = entry.clone();
        return entry;
    }

    entry.created_at = now.to_string();
    entries.push(entry.clone());
    entry
}

pub fn remove_entry(entries: &mut Vec<VaultEntry>, id: &str) {
    entries.retain(|e| e.id != id);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft(id: &str, label: &str, content: &str) -> VaultEntry {
        VaultEntry {
            id: id.to_string(),
            label: label.to_string(),
            content: content.to_string(),
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn new_entry_gets_generated_id_and_timestamps() {
        let mut entries = Vec::new();
        let saved = upsert_entry(&mut entries, draft("", "Wifi de casa", "senha: abc123"), "t1");

        assert!(!saved.id.is_empty());
        assert_eq!(saved.created_at, "t1");
        assert_eq!(saved.updated_at, "t1");
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn editing_existing_entry_preserves_created_at() {
        let mut entries = Vec::new();
        let created = upsert_entry(&mut entries, draft("", "Wifi", "senha antiga"), "t1");

        let edited = upsert_entry(
            &mut entries,
            draft(&created.id, "Wifi", "senha nova"),
            "t2",
        );

        assert_eq!(entries.len(), 1, "should replace, not duplicate");
        assert_eq!(edited.created_at, "t1");
        assert_eq!(edited.updated_at, "t2");
        assert_eq!(entries[0].content, "senha nova");
    }

    #[test]
    fn unknown_id_is_treated_as_new_entry() {
        let mut entries = Vec::new();
        let saved = upsert_entry(&mut entries, draft("stale-id", "Nota", "conteúdo"), "t1");

        assert_eq!(entries.len(), 1);
        assert_eq!(saved.id, "stale-id");
        assert_eq!(saved.created_at, "t1");
    }

    #[test]
    fn remove_entry_deletes_by_id() {
        let mut entries = Vec::new();
        let a = upsert_entry(&mut entries, draft("", "A", "1"), "t1");
        let _b = upsert_entry(&mut entries, draft("", "B", "2"), "t1");

        remove_entry(&mut entries, &a.id);

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].label, "B");
    }
}
