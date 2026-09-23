use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEntry {
    pub id: String,
    pub timestamp: String,
    pub file_name: String,
    pub from: String,
    pub to: Option<String>,
    pub rule_name: Option<String>,
    /// "moved" | "error"
    pub status: String,
    pub message: Option<String>,
}

impl ActivityEntry {
    pub fn moved(file_name: String, from: String, to: String, rule_name: String) -> Self {
        ActivityEntry {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: chrono::Local::now().to_rfc3339(),
            file_name,
            from,
            to: Some(to),
            rule_name: Some(rule_name),
            status: "moved".to_string(),
            message: None,
        }
    }

    pub fn error(file_name: String, from: String, message: String) -> Self {
        ActivityEntry {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: chrono::Local::now().to_rfc3339(),
            file_name,
            from,
            to: None,
            rule_name: None,
            status: "error".to_string(),
            message: Some(message),
        }
    }

    pub fn deleted(file_name: String, from: String, rule_name: String) -> Self {
        ActivityEntry {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: chrono::Local::now().to_rfc3339(),
            file_name,
            from,
            to: None,
            rule_name: Some(rule_name),
            status: "deleted".to_string(),
            message: None,
        }
    }
}

pub struct ActivityState(pub Mutex<VecDeque<ActivityEntry>>);

const MAX_ENTRIES: usize = 200;

pub fn push_activity(app: &AppHandle, entry: ActivityEntry) {
    {
        let state = app.state::<ActivityState>();
        let mut log = state.0.lock().unwrap();
        log.push_front(entry.clone());
        if log.len() > MAX_ENTRIES {
            log.pop_back();
        }
    }
    let _ = app.emit("activity", entry);
}
