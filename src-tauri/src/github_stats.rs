use crate::git_stats::{ContributorStats, GitStatsRange};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::thread;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubStats {
    pub total_prs_authored: u32,
    pub open_prs_authored: u32,
    pub merged_prs_authored_in_range: u32,
    pub closed_unmerged_in_range: u32,
    pub avg_time_to_merge_hours: Option<f64>,
    pub reviews_given_in_range: u32,
    pub issues_opened_in_range: u32,
    pub issues_closed_in_range: u32,
}

fn client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .user_agent("tonho-assistants")
        .build()
        .expect("reqwest client should build")
}

/// GET /user — used both to validate a token before saving it and to learn
/// the authenticated login for author-scoped search queries.
pub fn fetch_authenticated_user(token: &str) -> Result<String, String> {
    let resp = client()
        .get("https://api.github.com/user")
        .bearer_auth(token)
        .send()
        .map_err(|e| format!("Não foi possível conectar ao GitHub: {e}"))?;

    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("Token inválido ou sem permissão".to_string());
    }
    if !resp.status().is_success() {
        return Err(format!("GitHub retornou erro {}", resp.status()));
    }

    let body: Value = resp.json().map_err(|e| e.to_string())?;
    body.get("login")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Resposta inesperada do GitHub".to_string())
}

fn graphql(token: &str, query: &str, variables: Value) -> Result<Value, String> {
    let resp = client()
        .post("https://api.github.com/graphql")
        .bearer_auth(token)
        .json(&json!({ "query": query, "variables": variables }))
        .send()
        .map_err(|e| format!("Não foi possível conectar ao GitHub: {e}"))?;

    let status = resp.status();
    let body: Value = resp.json().map_err(|e| e.to_string())?;

    if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err("Limite de requisições do GitHub atingido, tente novamente em alguns minutos".to_string());
    }
    if let Some(errors) = body.get("errors") {
        return Err(format!("GitHub GraphQL retornou erro: {errors}"));
    }
    if !status.is_success() {
        return Err(format!("GitHub retornou erro {status}"));
    }

    Ok(body)
}

fn search_issue_count(token: &str, query: &str) -> Result<u32, String> {
    let gql = "query($q: String!) { search(query: $q, type: ISSUE) { issueCount } }";
    let body = graphql(token, gql, json!({ "q": query }))?;
    Ok(body["data"]["search"]["issueCount"].as_u64().unwrap_or(0) as u32)
}

#[derive(Debug, Clone)]
struct PrNode {
    created_at: String,
    merged_at: Option<String>,
    closed_at: Option<String>,
}

fn search_pr_nodes(token: &str, query: &str) -> Result<Vec<PrNode>, String> {
    let gql = r#"
        query($q: String!, $after: String) {
          search(query: $q, type: ISSUE, first: 100, after: $after) {
            issueCount
            pageInfo { hasNextPage endCursor }
            nodes {
              ... on PullRequest { createdAt mergedAt closedAt }
            }
          }
        }
    "#;

    let mut nodes = Vec::new();
    let mut after: Option<String> = None;

    loop {
        let body = graphql(token, gql, json!({ "q": query, "after": after }))?;
        let search = &body["data"]["search"];
        for n in search["nodes"].as_array().unwrap_or(&Vec::new()) {
            nodes.push(PrNode {
                created_at: n["createdAt"].as_str().unwrap_or_default().to_string(),
                merged_at: n["mergedAt"].as_str().map(|s| s.to_string()),
                closed_at: n["closedAt"].as_str().map(|s| s.to_string()),
            });
        }
        let has_next = search["pageInfo"]["hasNextPage"].as_bool().unwrap_or(false);
        if !has_next {
            break;
        }
        after = search["pageInfo"]["endCursor"].as_str().map(|s| s.to_string());
    }

    Ok(nodes)
}

fn parse_rfc3339_hours_between(a: &str, b: &str) -> Option<f64> {
    let a = chrono::DateTime::parse_from_rfc3339(a).ok()?;
    let b = chrono::DateTime::parse_from_rfc3339(b).ok()?;
    Some((b - a).num_minutes() as f64 / 60.0)
}

/// Fetches PR/issue/review stats for `login` on `owner/repo`. All-time
/// totals (Business Rule #1) use plain issueCount searches; range-scoped
/// numbers paginate PR nodes to compute merge/close counts and average
/// time-to-merge.
pub fn fetch_github_stats(
    token: &str,
    owner: &str,
    repo: &str,
    login: &str,
    range: &GitStatsRange,
) -> Result<GithubStats, String> {
    let repo_qualifier = format!("repo:{owner}/{repo}");

    let total_prs_authored =
        search_issue_count(token, &format!("{repo_qualifier} is:pr author:{login}"))?;
    let open_prs_authored =
        search_issue_count(token, &format!("{repo_qualifier} is:pr is:open author:{login}"))?;

    let range_query = format!(
        "{repo_qualifier} is:pr author:{login} created:{}..{}",
        range.since, range.until
    );
    let range_prs = search_pr_nodes(token, &range_query)?;

    let mut merged = 0u32;
    let mut closed_unmerged = 0u32;
    let mut merge_hours: Vec<f64> = Vec::new();

    for pr in &range_prs {
        if let Some(merged_at) = &pr.merged_at {
            merged += 1;
            if let Some(hours) = parse_rfc3339_hours_between(&pr.created_at, merged_at) {
                merge_hours.push(hours);
            }
        } else if pr.closed_at.is_some() {
            closed_unmerged += 1;
        }
    }

    let avg_time_to_merge_hours = if merge_hours.is_empty() {
        None
    } else {
        Some(merge_hours.iter().sum::<f64>() / merge_hours.len() as f64)
    };

    let issues_opened_in_range = search_issue_count(
        token,
        &format!(
            "{repo_qualifier} is:issue author:{login} created:{}..{}",
            range.since, range.until
        ),
    )?;
    let issues_closed_in_range = search_issue_count(
        token,
        &format!(
            "{repo_qualifier} is:issue author:{login} closed:{}..{}",
            range.since, range.until
        ),
    )?;
    // Best-effort: GitHub search has no "review submitted date" filter, so
    // this approximates "reviews given in range" via PRs updated in range
    // that this login reviewed — documented limitation, not exact.
    let reviews_given_in_range = search_issue_count(
        token,
        &format!(
            "{repo_qualifier} is:pr reviewed-by:{login} updated:{}..{}",
            range.since, range.until
        ),
    )?;

    Ok(GithubStats {
        total_prs_authored,
        open_prs_authored,
        merged_prs_authored_in_range: merged,
        closed_unmerged_in_range: closed_unmerged,
        avg_time_to_merge_hours,
        reviews_given_in_range,
        issues_opened_in_range,
        issues_closed_in_range,
    })
}

/// GET /repos/{owner}/{repo}/stats/contributors. GitHub computes this
/// asynchronously for repos it hasn't cached yet and responds 202 while it
/// works — retry a few times with a short backoff before giving up, per the
/// documented API quirk (see spec Risk Register).
pub fn fetch_contributor_stats(token: &str, owner: &str, repo: &str) -> Result<Vec<ContributorStats>, String> {
    let url = format!("https://api.github.com/repos/{owner}/{repo}/stats/contributors");
    let c = client();

    for attempt in 0..3 {
        let resp = c
            .get(&url)
            .bearer_auth(token)
            .send()
            .map_err(|e| format!("Não foi possível conectar ao GitHub: {e}"))?;

        if resp.status() == reqwest::StatusCode::ACCEPTED {
            if attempt < 2 {
                thread::sleep(Duration::from_millis(1500));
                continue;
            }
            return Err("GitHub ainda está calculando as estatísticas deste repositório, tente novamente em instantes".to_string());
        }
        if !resp.status().is_success() {
            return Err(format!("GitHub retornou erro {}", resp.status()));
        }

        let body: Vec<Value> = resp.json().map_err(|e| e.to_string())?;
        return Ok(body
            .into_iter()
            .map(|entry| {
                let author = &entry["author"];
                let total = entry["total"].as_u64().unwrap_or(0) as u32;
                let (mut additions, mut deletions) = (0u32, 0u32);
                for week in entry["weeks"].as_array().unwrap_or(&Vec::new()) {
                    additions += week["a"].as_u64().unwrap_or(0) as u32;
                    deletions += week["d"].as_u64().unwrap_or(0) as u32;
                }
                ContributorStats {
                    login: author["login"].as_str().unwrap_or("desconhecido").to_string(),
                    avatar_url: author["avatar_url"].as_str().map(|s| s.to_string()),
                    commit_count: total,
                    additions,
                    deletions,
                    is_me: false, // caller fills this in by matching against the token owner's login
                }
            })
            .collect());
    }

    unreachable!("loop always returns or errors within 3 attempts")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_hours_between_two_timestamps() {
        let hours = parse_rfc3339_hours_between(
            "2026-09-01T10:00:00Z",
            "2026-09-01T13:30:00Z",
        );
        assert_eq!(hours, Some(3.5));
    }

    #[test]
    fn invalid_timestamps_return_none() {
        assert_eq!(parse_rfc3339_hours_between("not-a-date", "2026-09-01T13:30:00Z"), None);
    }
}
