use chrono::{DateTime, Duration as ChronoDuration, Months, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub id: String,
    pub title: String,
    pub notes: String,
    /// RFC3339 timestamp
    pub due_at: String,
    /// "none" | "daily" | "weekly" | "monthly" | "yearly"
    pub repeat: String,
    pub done: bool,
    /// RFC3339 timestamp of the last time this reminder fired a
    /// notification; cleared when a repeating reminder rolls to its next
    /// occurrence so it can fire again.
    pub notified_at: Option<String>,
}

pub struct ReminderState(pub Mutex<Vec<Reminder>>);

fn reminders_path(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .expect("could not resolve app config dir");
    std::fs::create_dir_all(&dir).ok();
    dir.join("reminders.json")
}

pub fn load_reminders(app: &AppHandle) -> Vec<Reminder> {
    let path = reminders_path(app);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|data| serde_json::from_str(&data).ok())
        .unwrap_or_default()
}

pub fn save_reminders(app: &AppHandle, reminders: &[Reminder]) -> std::io::Result<()> {
    let path = reminders_path(app);
    let data = serde_json::to_string_pretty(reminders)?;
    std::fs::write(path, data)
}

pub fn upsert_reminder(reminders: &mut Vec<Reminder>, mut reminder: Reminder) -> Reminder {
    if reminder.id.trim().is_empty() {
        reminder.id = uuid::Uuid::new_v4().to_string();
        reminders.push(reminder.clone());
        return reminder;
    }

    if let Some(existing) = reminders.iter_mut().find(|r| r.id == reminder.id) {
        *existing = reminder.clone();
        return reminder;
    }

    reminders.push(reminder.clone());
    reminder
}

pub fn remove_reminder(reminders: &mut Vec<Reminder>, id: &str) {
    reminders.retain(|r| r.id != id);
}

/// A reminder is due when it isn't done, hasn't already notified for its
/// current occurrence, and its due time has passed. Pure — no I/O, easy to
/// pin down with a fixed `now` in tests.
pub fn is_due(reminder: &Reminder, now: DateTime<Utc>) -> bool {
    if reminder.done || reminder.notified_at.is_some() {
        return false;
    }
    match DateTime::parse_from_rfc3339(&reminder.due_at) {
        Ok(due) => due.with_timezone(&Utc) <= now,
        Err(_) => false,
    }
}

/// Marks a reminder as notified. Repeating reminders roll their `due_at`
/// forward and clear `notified_at` so they become eligible again next cycle;
/// one-off reminders just stay notified.
pub fn advance_after_notify(reminder: &mut Reminder, now: DateTime<Utc>) {
    reminder.notified_at = Some(now.to_rfc3339());

    let Ok(due) = DateTime::parse_from_rfc3339(&reminder.due_at) else {
        return;
    };
    let due = due.with_timezone(&Utc);

    let next = match reminder.repeat.as_str() {
        "daily" => Some(due + ChronoDuration::days(1)),
        "weekly" => Some(due + ChronoDuration::weeks(1)),
        "monthly" => due.checked_add_months(Months::new(1)),
        "yearly" => due.checked_add_months(Months::new(12)),
        _ => None,
    };

    if let Some(next) = next {
        reminder.due_at = next.to_rfc3339();
        reminder.notified_at = None;
    }
}

/// Checks every reminder for `app`, fires an OS notification for each one
/// that's due, persists the updated state, and returns how many fired.
pub fn run_reminder_check(app: &AppHandle) -> u32 {
    let state = app.state::<ReminderState>();
    let now = Utc::now();
    let mut fired = 0u32;

    {
        let mut reminders = state.0.lock().unwrap();
        for reminder in reminders.iter_mut() {
            if !is_due(reminder, now) {
                continue;
            }

            let _ = app
                .notification()
                .builder()
                .title(&reminder.title)
                .body(if reminder.notes.is_empty() {
                    "Lembrete do Tonho Assistants"
                } else {
                    &reminder.notes
                })
                .show();

            advance_after_notify(reminder, now);
            fired += 1;
        }

        let _ = save_reminders(app, &reminders);
    }

    fired
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reminder_due_at(due_at: &str, repeat: &str) -> Reminder {
        Reminder {
            id: "r1".to_string(),
            title: "Pagar conta".to_string(),
            notes: String::new(),
            due_at: due_at.to_string(),
            repeat: repeat.to_string(),
            done: false,
            notified_at: None,
        }
    }

    #[test]
    fn not_due_before_its_time() {
        let now: DateTime<Utc> = "2026-01-01T12:00:00Z".parse().unwrap();
        let reminder = reminder_due_at("2026-01-01T13:00:00Z", "none");
        assert!(!is_due(&reminder, now));
    }

    #[test]
    fn due_once_time_has_passed() {
        let now: DateTime<Utc> = "2026-01-01T12:00:00Z".parse().unwrap();
        let reminder = reminder_due_at("2026-01-01T11:00:00Z", "none");
        assert!(is_due(&reminder, now));
    }

    #[test]
    fn already_notified_is_not_due_again() {
        let now: DateTime<Utc> = "2026-01-01T12:00:00Z".parse().unwrap();
        let mut reminder = reminder_due_at("2026-01-01T11:00:00Z", "none");
        reminder.notified_at = Some("2026-01-01T11:05:00Z".to_string());
        assert!(!is_due(&reminder, now));
    }

    #[test]
    fn done_reminder_is_never_due() {
        let now: DateTime<Utc> = "2026-01-01T12:00:00Z".parse().unwrap();
        let mut reminder = reminder_due_at("2026-01-01T11:00:00Z", "none");
        reminder.done = true;
        assert!(!is_due(&reminder, now));
    }

    #[test]
    fn one_off_reminder_stays_notified_after_firing() {
        let now: DateTime<Utc> = "2026-01-01T12:00:00Z".parse().unwrap();
        let mut reminder = reminder_due_at("2026-01-01T11:00:00Z", "none");
        advance_after_notify(&mut reminder, now);
        assert!(reminder.notified_at.is_some());
        assert!(!is_due(&reminder, now));
    }

    #[test]
    fn daily_reminder_rolls_forward_and_becomes_due_again_next_day() {
        let now: DateTime<Utc> = "2026-01-01T12:00:00Z".parse().unwrap();
        let mut reminder = reminder_due_at("2026-01-01T11:00:00Z", "daily");

        advance_after_notify(&mut reminder, now);
        assert_eq!(reminder.due_at, "2026-01-02T11:00:00+00:00");
        assert!(reminder.notified_at.is_none());
        assert!(!is_due(&reminder, now), "shouldn't be due again immediately");

        let next_day: DateTime<Utc> = "2026-01-02T11:30:00Z".parse().unwrap();
        assert!(is_due(&reminder, next_day));
    }

    #[test]
    fn weekly_reminder_rolls_forward_seven_days() {
        let now: DateTime<Utc> = "2026-01-01T12:00:00Z".parse().unwrap();
        let mut reminder = reminder_due_at("2026-01-01T11:00:00Z", "weekly");
        advance_after_notify(&mut reminder, now);
        assert_eq!(reminder.due_at, "2026-01-08T11:00:00+00:00");
    }

    #[test]
    fn monthly_reminder_rolls_forward_one_month() {
        let now: DateTime<Utc> = "2026-01-15T12:00:00Z".parse().unwrap();
        let mut reminder = reminder_due_at("2026-01-15T09:00:00Z", "monthly");
        advance_after_notify(&mut reminder, now);
        assert_eq!(reminder.due_at, "2026-02-15T09:00:00+00:00");
        assert!(reminder.notified_at.is_none());
    }

    #[test]
    fn yearly_reminder_rolls_forward_one_year() {
        let now: DateTime<Utc> = "2026-03-10T12:00:00Z".parse().unwrap();
        let mut reminder = reminder_due_at("2026-03-10T09:00:00Z", "yearly");
        advance_after_notify(&mut reminder, now);
        assert_eq!(reminder.due_at, "2027-03-10T09:00:00+00:00");
    }
}
