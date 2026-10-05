use crate::github_stats::GithubStats;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Command;
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct GitStatsRange {
    pub since: String, // RFC3339
    pub until: String, // RFC3339
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommitsByDay {
    pub date: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChurn {
    pub path: String,
    pub changes: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalGitStats {
    pub commit_count: u32,
    pub additions: u32,
    pub deletions: u32,
    pub commits_by_day: Vec<CommitsByDay>,
    pub top_files: Vec<FileChurn>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributorStats {
    pub login: String,
    pub avatar_url: Option<String>,
    pub commit_count: u32,
    pub additions: u32,
    pub deletions: u32,
    pub is_me: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitProjectStats {
    pub local: LocalGitStats,
    pub github: Option<GithubStats>,
    /// Set whenever GitHub-backed data couldn't be fetched (invalid token,
    /// repo outside the token's scope, rate limit, network error, ...) so the
    /// UI can explain the gap instead of silently showing nothing. `None`
    /// when there's no token/remote configured at all (nothing to explain)
    /// or when the fetch succeeded.
    pub github_error: Option<String>,
    pub contributors: Vec<ContributorStats>,
    pub range: GitStatsRange,
    pub fetched_at: String,
    pub from_cache: bool,
}

const GS: char = '\u{1f}';

/// Runs `git log --numstat` in `path` for the given range and returns the
/// raw stdout. Delimits commit headers with the unit separator control
/// character so parsing never trips on commit messages containing tabs or
/// pipes.
pub fn run_git_log(path: &str, range: &GitStatsRange) -> Result<String, String> {
    let format = format!("C{GS}%H{GS}%an{GS}%ae{GS}%aI");
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args([
            "log",
            &format!("--since={}", range.since),
            &format!("--until={}", range.until),
            &format!("--pretty=format:{format}"),
            "--numstat",
        ])
        .output()
        .map_err(|e| format!("Falha ao rodar git: {e}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

struct AuthorAgg {
    name: String,
    email: String,
    commit_count: u32,
    additions: u32,
    deletions: u32,
}

/// Parses `git log --numstat` output (see `run_git_log`'s format string)
/// into repo-wide stats plus a per-author breakdown. Pure — no I/O — so
/// tests exercise it with fixed strings instead of a real repo.
pub fn parse_git_log_output(
    raw: &str,
    my_emails: &[String],
) -> (LocalGitStats, Vec<ContributorStats>) {
    let my_emails: Vec<String> = my_emails.iter().map(|e| e.to_lowercase()).collect();

    let mut commit_count = 0u32;
    let mut additions = 0u32;
    let mut deletions = 0u32;
    let mut by_day: HashMap<String, u32> = HashMap::new();
    let mut file_changes: HashMap<String, u32> = HashMap::new();
    let mut authors: HashMap<String, AuthorAgg> = HashMap::new();

    let mut current_email: Option<String> = None;

    for line in raw.lines() {
        if let Some(rest) = line.strip_prefix('C').and_then(|l| l.strip_prefix(GS)) {
            let mut parts = rest.splitn(4, GS);
            let _hash = parts.next().unwrap_or_default();
            let name = parts.next().unwrap_or_default().to_string();
            let email = parts.next().unwrap_or_default().to_string();
            let date = parts.next().unwrap_or_default();

            commit_count += 1;
            if let Some(day) = date.get(0..10) {
                *by_day.entry(day.to_string()).or_insert(0) += 1;
            }

            let entry = authors.entry(email.to_lowercase()).or_insert_with(|| AuthorAgg {
                name: name.clone(),
                email: email.clone(),
                commit_count: 0,
                additions: 0,
                deletions: 0,
            });
            entry.commit_count += 1;
            current_email = Some(email.to_lowercase());
            continue;
        }

        // --numstat line: "<added>\t<deleted>\t<path>" (binary files use "-")
        let mut cols = line.splitn(3, '\t');
        let added = cols.next().unwrap_or_default();
        let deleted = cols.next().unwrap_or_default();
        let path = cols.next().unwrap_or_default();
        if path.is_empty() {
            continue;
        }

        let added_n: u32 = added.parse().unwrap_or(0);
        let deleted_n: u32 = deleted.parse().unwrap_or(0);

        additions += added_n;
        deletions += deleted_n;
        *file_changes.entry(path.to_string()).or_insert(0) += added_n + deleted_n;

        if let Some(email) = &current_email {
            if let Some(entry) = authors.get_mut(email) {
                entry.additions += added_n;
                entry.deletions += deleted_n;
            }
        }
    }

    let mut commits_by_day: Vec<CommitsByDay> = by_day
        .into_iter()
        .map(|(date, count)| CommitsByDay { date, count })
        .collect();
    commits_by_day.sort_by(|a, b| a.date.cmp(&b.date));

    let mut top_files: Vec<FileChurn> = file_changes
        .into_iter()
        .map(|(path, changes)| FileChurn { path, changes })
        .collect();
    top_files.sort_by(|a, b| b.changes.cmp(&a.changes));
    top_files.truncate(10);

    let mut contributors: Vec<ContributorStats> = authors
        .into_values()
        .map(|a| ContributorStats {
            is_me: my_emails.contains(&a.email.to_lowercase()),
            login: a.name,
            avatar_url: None,
            commit_count: a.commit_count,
            additions: a.additions,
            deletions: a.deletions,
        })
        .collect();
    contributors.sort_by(|a, b| b.commit_count.cmp(&a.commit_count));

    (
        LocalGitStats {
            commit_count,
            additions,
            deletions,
            commits_by_day,
            top_files,
        },
        contributors,
    )
}

/// In-memory cache for computed stats, keyed by (project id, range). TTL of
/// 10 minutes; `refresh` bypasses it. Mirrors the `WatcherState` pattern
/// (State<Mutex<HashMap<...>>>) already used elsewhere in this app.
pub struct StatsCacheState(pub std::sync::Mutex<HashMap<(String, GitStatsRange), (Instant, GitProjectStats)>>);

const CACHE_TTL_SECS: u64 = 600;

pub fn cache_get(
    cache: &StatsCacheState,
    project_id: &str,
    range: &GitStatsRange,
) -> Option<GitProjectStats> {
    let map = cache.0.lock().unwrap();
    let (cached_at, stats) = map.get(&(project_id.to_string(), range.clone()))?;
    if cached_at.elapsed().as_secs() > CACHE_TTL_SECS {
        return None;
    }
    let mut stats = stats.clone();
    stats.from_cache = true;
    Some(stats)
}

pub fn cache_put(cache: &StatsCacheState, project_id: &str, range: &GitStatsRange, stats: GitProjectStats) {
    let mut map = cache.0.lock().unwrap();
    map.insert((project_id.to_string(), range.clone()), (Instant::now(), stats));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_log() -> String {
        [
            format!("C{GS}h1{GS}Ana{GS}ana@example.com{GS}2026-09-01T10:00:00-03:00"),
            "10\t2\tsrc/main.rs".to_string(),
            "5\t0\tsrc/lib.rs".to_string(),
            format!("C{GS}h2{GS}Bruno{GS}bruno@example.com{GS}2026-09-01T14:00:00-03:00"),
            "3\t1\tsrc/main.rs".to_string(),
            format!("C{GS}h3{GS}Ana{GS}ana@example.com{GS}2026-09-02T09:00:00-03:00"),
            "1\t1\tREADME.md".to_string(),
        ]
        .join("\n")
    }

    #[test]
    fn aggregates_repo_wide_totals() {
        let (local, _) = parse_git_log_output(&sample_log(), &[]);
        assert_eq!(local.commit_count, 3);
        assert_eq!(local.additions, 19);
        assert_eq!(local.deletions, 4);
    }

    #[test]
    fn groups_commits_by_day() {
        let (local, _) = parse_git_log_output(&sample_log(), &[]);
        assert_eq!(local.commits_by_day.len(), 2);
        assert_eq!(local.commits_by_day[0], CommitsByDay { date: "2026-09-01".into(), count: 2 });
        assert_eq!(local.commits_by_day[1], CommitsByDay { date: "2026-09-02".into(), count: 1 });
    }

    #[test]
    fn ranks_top_files_by_total_churn() {
        let (local, _) = parse_git_log_output(&sample_log(), &[]);
        assert_eq!(local.top_files[0].path, "src/main.rs");
        assert_eq!(local.top_files[0].changes, 16); // 10+2 + 3+1
    }

    #[test]
    fn breaks_down_contributors_and_flags_me() {
        let (_, contributors) = parse_git_log_output(&sample_log(), &["ana@example.com".to_string()]);
        assert_eq!(contributors.len(), 2);

        let ana = contributors.iter().find(|c| c.login == "Ana").unwrap();
        assert!(ana.is_me);
        assert_eq!(ana.commit_count, 2);
        assert_eq!(ana.additions, 16); // 10+5+1
        assert_eq!(ana.deletions, 3); // 2+0+1

        let bruno = contributors.iter().find(|c| c.login == "Bruno").unwrap();
        assert!(!bruno.is_me);
        assert_eq!(bruno.commit_count, 1);
    }

    #[test]
    fn empty_log_yields_zeroed_stats() {
        let (local, contributors) = parse_git_log_output("", &[]);
        assert_eq!(local.commit_count, 0);
        assert_eq!(local.additions, 0);
        assert!(local.commits_by_day.is_empty());
        assert!(contributors.is_empty());
    }

    #[test]
    fn binary_file_markers_do_not_panic_or_count_as_lines() {
        let log = format!(
            "C{GS}h1{GS}Ana{GS}ana@example.com{GS}2026-09-01T10:00:00-03:00\n-\t-\tassets/logo.png"
        );
        let (local, _) = parse_git_log_output(&log, &[]);
        assert_eq!(local.commit_count, 1);
        assert_eq!(local.additions, 0);
        assert_eq!(local.deletions, 0);
    }

    #[test]
    fn cache_hit_within_ttl() {
        let cache = StatsCacheState(std::sync::Mutex::new(HashMap::new()));
        let range = GitStatsRange { since: "a".into(), until: "b".into() };
        let stats = GitProjectStats {
            local: LocalGitStats { commit_count: 1, additions: 0, deletions: 0, commits_by_day: vec![], top_files: vec![] },
            github: None,
            github_error: None,
            contributors: vec![],
            range: range.clone(),
            fetched_at: "now".into(),
            from_cache: false,
        };
        cache_put(&cache, "p1", &range, stats);

        let hit = cache_get(&cache, "p1", &range);
        assert!(hit.is_some());
        assert!(hit.unwrap().from_cache);
    }

    #[test]
    fn cache_miss_for_different_range() {
        let cache = StatsCacheState(std::sync::Mutex::new(HashMap::new()));
        let range_a = GitStatsRange { since: "a".into(), until: "b".into() };
        let range_b = GitStatsRange { since: "c".into(), until: "d".into() };
        let stats = GitProjectStats {
            local: LocalGitStats { commit_count: 1, additions: 0, deletions: 0, commits_by_day: vec![], top_files: vec![] },
            github: None,
            github_error: None,
            contributors: vec![],
            range: range_a.clone(),
            fetched_at: "now".into(),
            from_cache: false,
        };
        cache_put(&cache, "p1", &range_a, stats);

        assert!(cache_get(&cache, "p1", &range_b).is_none());
    }
}
