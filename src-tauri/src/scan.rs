use crate::config::Watcher;
use crate::watcher::{apply_and_log, extension_of, IGNORED_EXTENSIONS};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub moved: u32,
    pub skipped: u32,
}

/// Lists eligible files directly inside `dir` (non-recursive), skipping
/// partial-download extensions. Pure I/O, no rule matching — the seam unit
/// tests hang off of.
pub fn eligible_files(dir: &Path) -> std::io::Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if IGNORED_EXTENSIONS.contains(&extension_of(&path).as_str()) {
            continue;
        }
        files.push(path);
    }
    Ok(files)
}

/// Runs every enabled rule of `watcher` against the files already sitting in
/// its folder (retroactive "organize now" scan).
pub fn scan_folder(app: &AppHandle, watcher: &Watcher) -> std::io::Result<ScanResult> {
    let mut moved = 0u32;
    let mut skipped = 0u32;

    for path in eligible_files(Path::new(&watcher.folder))? {
        if apply_and_log(app, &path, watcher) {
            moved += 1;
        } else {
            skipped += 1;
        }
    }

    Ok(ScanResult { moved, skipped })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eligible_files_lists_regular_files_only() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("a.png"), b"x").unwrap();
        std::fs::write(tmp.path().join("b.pdf"), b"x").unwrap();
        std::fs::create_dir(tmp.path().join("subfolder")).unwrap();

        let files = eligible_files(tmp.path()).unwrap();
        assert_eq!(files.len(), 2);
    }

    #[test]
    fn eligible_files_skips_partial_downloads() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("a.png"), b"x").unwrap();
        std::fs::write(tmp.path().join("still-downloading.crdownload"), b"x").unwrap();
        std::fs::write(tmp.path().join("half.tmp"), b"x").unwrap();

        let files = eligible_files(tmp.path()).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].file_name().unwrap(), "a.png");
    }
}
