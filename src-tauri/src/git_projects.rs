use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitProject {
    pub id: String,
    pub name: String,
    pub local_path: String,
    pub github_owner: Option<String>,
    pub github_repo: Option<String>,
    pub my_emails: Vec<String>,
    pub enabled: bool,
}

pub struct GitProjectState(pub Mutex<Vec<GitProject>>);

fn git_projects_path(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .expect("could not resolve app config dir");
    std::fs::create_dir_all(&dir).ok();
    dir.join("git_projects.json")
}

pub fn load_git_projects(app: &AppHandle) -> Vec<GitProject> {
    let path = git_projects_path(app);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|data| serde_json::from_str(&data).ok())
        .unwrap_or_default()
}

pub fn save_git_projects(app: &AppHandle, projects: &[GitProject]) -> std::io::Result<()> {
    let path = git_projects_path(app);
    let data = serde_json::to_string_pretty(projects)?;
    std::fs::write(path, data)
}

/// Inserts a brand-new project (empty id) or replaces an existing one by id.
/// Pure — the seam unit tests hang off of.
pub fn upsert_project(projects: &mut Vec<GitProject>, mut project: GitProject) -> GitProject {
    if project.id.trim().is_empty() {
        project.id = uuid::Uuid::new_v4().to_string();
        projects.push(project.clone());
        return project;
    }

    if let Some(existing) = projects.iter_mut().find(|p| p.id == project.id) {
        *existing = project.clone();
        return project;
    }

    projects.push(project.clone());
    project
}

pub fn remove_project(projects: &mut Vec<GitProject>, id: &str) {
    projects.retain(|p| p.id != id);
}

/// Runs `git` in `path` and returns trimmed stdout, or None if the command
/// failed to run or exited non-zero (covers "git not installed" and "not a
/// git repo" alike — callers only need to distinguish the two cases they
/// actually branch on).
fn run_git(path: &str, args: &[&str]) -> Option<String> {
    let output = Command::new("git").arg("-C").arg(path).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn is_git_repo(path: &str) -> bool {
    run_git(path, &["rev-parse", "--is-inside-work-tree"])
        .map(|s| s == "true")
        .unwrap_or(false)
}

fn local_user_email(path: &str) -> Option<String> {
    run_git(path, &["config", "user.email"]).filter(|s| !s.is_empty())
}

fn remote_origin_url(path: &str) -> Option<String> {
    run_git(path, &["remote", "get-url", "origin"]).filter(|s| !s.is_empty())
}

/// Parses a git remote URL into (owner, repo) if it points at github.com.
/// Supports both HTTPS (`https://github.com/owner/repo.git`) and SSH
/// (`git@github.com:owner/repo.git`) forms. Returns None for any other host
/// (GitLab, Bitbucket, local-only remotes, etc.) — those projects simply get
/// no GitHub-backed stats, per Business Rule #4.
pub fn parse_github_remote(url: &str) -> Option<(String, String)> {
    let rest = if let Some(r) = url.strip_prefix("https://github.com/") {
        r
    } else if let Some(r) = url.strip_prefix("http://github.com/") {
        r
    } else if let Some(r) = url.strip_prefix("git@github.com:") {
        r
    } else if let Some(r) = url.strip_prefix("ssh://git@github.com/") {
        r
    } else {
        return None;
    };

    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let mut parts = rest.splitn(2, '/');
    let owner = parts.next()?.trim();
    let repo = parts.next()?.trim();
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    Some((owner.to_string(), repo.to_string()))
}

fn default_project_name(path: &str) -> String {
    PathBuf::from(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

/// Builds a new GitProject draft from a chosen local folder: validates it's
/// a git repo, detects the GitHub owner/repo from `origin` if present, and
/// seeds `my_emails` from the local git config. Returns an error string
/// (surfaced verbatim to the UI) if the folder isn't a git repository.
pub fn build_project_from_path(path: &str) -> Result<GitProject, String> {
    if !is_git_repo(path) {
        return Err("Essa pasta não é um repositório git".to_string());
    }

    let (github_owner, github_repo) = remote_origin_url(path)
        .and_then(|url| parse_github_remote(&url))
        .map(|(o, r)| (Some(o), Some(r)))
        .unwrap_or((None, None));

    let my_emails = local_user_email(path).into_iter().collect();

    Ok(GitProject {
        id: String::new(),
        name: default_project_name(path),
        local_path: path.to_string(),
        github_owner,
        github_repo,
        my_emails,
        enabled: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft(id: &str, name: &str) -> GitProject {
        GitProject {
            id: id.to_string(),
            name: name.to_string(),
            local_path: "C:\\repo".to_string(),
            github_owner: None,
            github_repo: None,
            my_emails: vec![],
            enabled: true,
        }
    }

    #[test]
    fn new_project_gets_generated_id() {
        let mut projects = Vec::new();
        let saved = upsert_project(&mut projects, draft("", "Meu Repo"));

        assert!(!saved.id.is_empty());
        assert_eq!(projects.len(), 1);
    }

    #[test]
    fn editing_existing_project_replaces_not_duplicates() {
        let mut projects = Vec::new();
        let created = upsert_project(&mut projects, draft("", "Repo"));

        let mut edited = created.clone();
        edited.name = "Repo Renomeado".to_string();
        upsert_project(&mut projects, edited);

        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, "Repo Renomeado");
    }

    #[test]
    fn remove_project_deletes_by_id() {
        let mut projects = Vec::new();
        let a = upsert_project(&mut projects, draft("", "A"));
        let _b = upsert_project(&mut projects, draft("", "B"));

        remove_project(&mut projects, &a.id);

        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, "B");
    }

    #[test]
    fn parses_https_github_remote() {
        let parsed = parse_github_remote("https://github.com/samuelcolares/tonho-assistants.git");
        assert_eq!(
            parsed,
            Some(("samuelcolares".to_string(), "tonho-assistants".to_string()))
        );
    }

    #[test]
    fn parses_https_github_remote_without_dot_git_suffix() {
        let parsed = parse_github_remote("https://github.com/samuelcolares/tonho-assistants");
        assert_eq!(
            parsed,
            Some(("samuelcolares".to_string(), "tonho-assistants".to_string()))
        );
    }

    #[test]
    fn parses_ssh_github_remote() {
        let parsed = parse_github_remote("git@github.com:samuelcolares/tonho-assistants.git");
        assert_eq!(
            parsed,
            Some(("samuelcolares".to_string(), "tonho-assistants".to_string()))
        );
    }

    #[test]
    fn non_github_remote_returns_none() {
        assert_eq!(parse_github_remote("https://gitlab.com/owner/repo.git"), None);
        assert_eq!(parse_github_remote("https://bitbucket.org/owner/repo.git"), None);
    }

    #[test]
    fn build_project_from_path_rejects_non_git_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let result = build_project_from_path(tmp.path().to_str().unwrap());
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Essa pasta não é um repositório git");
    }

    #[test]
    fn build_project_from_path_accepts_git_repo_without_remote() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().to_str().unwrap();
        Command::new("git")
            .arg("-C")
            .arg(path)
            .args(["init", "-q"])
            .output()
            .expect("git init should run in test env");

        let project = build_project_from_path(path).expect("should build project");
        assert_eq!(project.github_owner, None);
        assert_eq!(project.github_repo, None);
        assert!(!project.name.is_empty());
    }
}
