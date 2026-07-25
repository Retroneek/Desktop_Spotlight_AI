use serde::Serialize;
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::{Path, PathBuf},
};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

const MAX_FILE_SIZE: u64 = 200 * 1024;
const MAX_INCLUDED_FILES: usize = 30;
const MAX_CONTEXT_CHARACTERS: usize = 12_000;
const MAX_FILE_CONTEXT_CHARACTERS: usize = 1_800;
const MAX_TREE_ENTRIES: usize = 80;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFolderScan {
    root_name: String,
    files_found: usize,
    files_included: usize,
    files_ignored: usize,
    files_skipped: usize,
    total_bytes: u64,
    total_characters: usize,
    included_files: Vec<ProjectFolderFile>,
    skipped_files: Vec<SkippedFolderFile>,
    tree: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFolderFile {
    path: String,
    size: u64,
    contents: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedFolderFile {
    path: String,
    reason: SkippedReason,
}

#[derive(Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SkippedReason {
    Ignored,
    TooLarge,
    Unsupported,
    ContextLimit,
}

#[derive(Default)]
struct TreeNode {
    children: BTreeMap<String, TreeNode>,
    is_file: bool,
}

#[tauri::command]
pub async fn select_project_folder(app: AppHandle) -> Result<Option<ProjectFolderScan>, String> {
    let Some(folder_path) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };

    let folder_path = folder_path
        .into_path()
        .map_err(|error| format!("Could not read selected folder path: {error}"))?;

    scan_project_folder(folder_path).map(Some)
}

fn scan_project_folder(root_path: PathBuf) -> Result<ProjectFolderScan, String> {
    let root_name = root_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Selected folder")
        .to_string();
    let mut files_found = 0usize;
    let mut files_ignored = 0usize;
    let mut files_skipped = 0usize;
    let mut total_bytes = 0u64;
    let mut total_characters = 0usize;
    let mut included_files = Vec::new();
    let mut skipped_files = Vec::new();
    let mut tree_paths = Vec::new();

    scan_directory(
        &root_path,
        &root_path,
        &root_name,
        &mut files_found,
        &mut files_ignored,
        &mut files_skipped,
        &mut total_bytes,
        &mut total_characters,
        &mut included_files,
        &mut skipped_files,
        &mut tree_paths,
    )?;

    Ok(ProjectFolderScan {
        root_name: root_name.clone(),
        files_found,
        files_included: included_files.len(),
        files_ignored,
        files_skipped,
        total_bytes,
        total_characters,
        tree: format_file_tree(&tree_paths, &root_name),
        included_files,
        skipped_files,
    })
}

#[allow(clippy::too_many_arguments)]
fn scan_directory(
    directory: &Path,
    root_path: &Path,
    root_name: &str,
    files_found: &mut usize,
    files_ignored: &mut usize,
    files_skipped: &mut usize,
    total_bytes: &mut u64,
    total_characters: &mut usize,
    included_files: &mut Vec<ProjectFolderFile>,
    skipped_files: &mut Vec<SkippedFolderFile>,
    tree_paths: &mut Vec<String>,
) -> Result<(), String> {
    let mut entries = fs::read_dir(directory)
        .map_err(|error| format!("Could not scan {}: {error}", directory.display()))?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    entries.sort_by(|left, right| {
        let left_path = relative_project_path(root_path, root_name, &left.path());
        let right_path = relative_project_path(root_path, root_name, &right.path());

        get_project_file_priority(&left_path)
            .cmp(&get_project_file_priority(&right_path))
            .then_with(|| left_path.cmp(&right_path))
    });

    for entry in entries {
        let path = entry.path();
        let relative_path = relative_project_path(root_path, root_name, &path);

        if path.is_dir() {
            if is_ignored_directory(&path) {
                *files_ignored += 1;
                continue;
            }

            scan_directory(
                &path,
                root_path,
                root_name,
                files_found,
                files_ignored,
                files_skipped,
                total_bytes,
                total_characters,
                included_files,
                skipped_files,
                tree_paths,
            )?;
            continue;
        }

        if !path.is_file() {
            continue;
        }

        *files_found += 1;

        if is_ignored_file(&path) {
            *files_ignored += 1;
            skipped_files.push(SkippedFolderFile {
                path: relative_path,
                reason: SkippedReason::Ignored,
            });
            continue;
        }

        if !is_supported_project_file(&path) {
            *files_skipped += 1;
            skipped_files.push(SkippedFolderFile {
                path: relative_path.clone(),
                reason: SkippedReason::Unsupported,
            });
            tree_paths.push(relative_path);
            continue;
        }

        let metadata = fs::metadata(&path)
            .map_err(|error| format!("Could not read file metadata: {error}"))?;

        if metadata.len() > MAX_FILE_SIZE {
            *files_skipped += 1;
            skipped_files.push(SkippedFolderFile {
                path: relative_path.clone(),
                reason: SkippedReason::TooLarge,
            });
            tree_paths.push(relative_path);
            continue;
        }

        if included_files.len() >= MAX_INCLUDED_FILES || *total_characters >= MAX_CONTEXT_CHARACTERS
        {
            *files_skipped += 1;
            skipped_files.push(SkippedFolderFile {
                path: relative_path.clone(),
                reason: SkippedReason::ContextLimit,
            });
            tree_paths.push(relative_path);
            continue;
        }

        let contents = match fs::read_to_string(&path) {
            Ok(contents) => clean_text(&contents),
            Err(_) => {
                *files_skipped += 1;
                skipped_files.push(SkippedFolderFile {
                    path: relative_path.clone(),
                    reason: SkippedReason::Unsupported,
                });
                tree_paths.push(relative_path);
                continue;
            }
        };
        let remaining_characters = MAX_CONTEXT_CHARACTERS - *total_characters;
        let contents = truncate_to_characters(
            &contents,
            remaining_characters.min(MAX_FILE_CONTEXT_CHARACTERS),
        );

        *total_characters += contents.chars().count();
        *total_bytes += metadata.len();
        tree_paths.push(relative_path.clone());
        included_files.push(ProjectFolderFile {
            path: relative_path,
            size: metadata.len(),
            contents,
        });
    }

    Ok(())
}

fn relative_project_path(root_path: &Path, root_name: &str, path: &Path) -> String {
    let relative = path.strip_prefix(root_path).unwrap_or(path);
    let relative = relative
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .collect::<Vec<_>>()
        .join("/");

    if relative.is_empty() {
        root_name.to_string()
    } else {
        format!("{root_name}/{relative}")
    }
}

fn is_ignored_directory(path: &Path) -> bool {
    let ignored_segments = ignored_directory_names();

    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| ignored_segments.contains(&name.to_lowercase()))
        .unwrap_or(false)
}

fn is_ignored_file(path: &Path) -> bool {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_lowercase();

    matches!(
        file_name.as_str(),
        ".ds_store"
            | ".env"
            | "package-lock.json"
            | "pnpm-lock.yaml"
            | "yarn.lock"
            | "bun.lockb"
            | "cargo.lock"
    )
}

fn is_supported_project_file(path: &Path) -> bool {
    let supported_file_names = supported_file_names();
    let supported_extensions = supported_extensions();
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_lowercase();

    if supported_file_names.contains(&file_name) {
        return true;
    }

    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| supported_extensions.contains(&format!(".{}", extension.to_lowercase())))
        .unwrap_or(false)
}

fn ignored_directory_names() -> HashSet<String> {
    [
        "node_modules",
        ".git",
        "dist",
        "build",
        "target",
        ".cache",
        ".next",
        ".vite",
    ]
    .into_iter()
    .map(String::from)
    .collect()
}

fn supported_extensions() -> HashSet<String> {
    [
        ".md", ".txt", ".json", ".ts", ".tsx", ".js", ".jsx", ".css", ".html", ".rs", ".toml",
    ]
    .into_iter()
    .map(String::from)
    .collect()
}

fn supported_file_names() -> HashSet<String> {
    [".env.example", ".gitignore", "package.json", "readme.md"]
        .into_iter()
        .map(String::from)
        .collect()
}

fn get_project_file_priority(path: &str) -> usize {
    let normalized_path = path.to_lowercase();
    let base_name = normalized_path
        .rsplit('/')
        .next()
        .unwrap_or(normalized_path.as_str());

    if base_name == "readme.md" {
        return 0;
    }

    if base_name == "package.json" {
        return 1;
    }

    if normalized_path.ends_with("src/app.tsx") {
        return 2;
    }

    if normalized_path.ends_with("src/services/ollama.tsx") {
        return 3;
    }

    if normalized_path.ends_with("src/services/contextbuilder.ts") {
        return 4;
    }

    if normalized_path.ends_with("src/app.css") {
        return 5;
    }

    if normalized_path.ends_with("src-tauri/src/lib.rs") {
        return 6;
    }

    if normalized_path.ends_with("src-tauri/src/commands/files.rs") {
        return 7;
    }

    if normalized_path.ends_with("src-tauri/tauri.conf.json") {
        return 8;
    }

    if normalized_path.contains("/src/") {
        return 20;
    }

    if normalized_path.contains("/src-tauri/") {
        return 30;
    }

    if base_name.ends_with(".json") {
        return 60;
    }

    40
}

fn clean_text(text: &str) -> String {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut output = String::new();
    let mut blank_count = 0usize;

    for line in normalized.lines() {
        let trimmed_end = line.trim_end();

        if trimmed_end.is_empty() {
            blank_count += 1;

            if blank_count <= 1 {
                output.push('\n');
            }

            continue;
        }

        blank_count = 0;
        output.push_str(trimmed_end);
        output.push('\n');
    }

    output.trim().to_string()
}

fn truncate_to_characters(text: &str, max_characters: usize) -> String {
    if text.chars().count() <= max_characters {
        return text.to_string();
    }

    let mut truncated = text.chars().take(max_characters).collect::<String>();
    truncated.push_str(&format!(
        "\n\n[Context truncated at {} characters]",
        max_characters
    ));
    truncated
}

fn format_file_tree(paths: &[String], root_name: &str) -> String {
    let mut root = TreeNode::default();
    let mut lines = vec![format!("{root_name}/")];

    for path in paths.iter().take(MAX_TREE_ENTRIES) {
        let mut segments = path
            .split('/')
            .filter(|segment| !segment.is_empty())
            .collect::<Vec<_>>();

        if segments.first() == Some(&root_name) {
            segments.remove(0);
        }

        let mut current_node = &mut root;

        for (index, segment) in segments.iter().enumerate() {
            current_node = current_node
                .children
                .entry((*segment).to_string())
                .or_default();
            current_node.is_file = index == segments.len() - 1;
        }
    }

    append_tree_lines(&root, "", &mut lines);

    if lines.len() == 1 {
        lines.push("└─ No supported project files included".to_string());
    }

    if paths.len() > MAX_TREE_ENTRIES {
        lines.push(format!(
            "└─ ... {} more files",
            paths.len() - MAX_TREE_ENTRIES
        ));
    }

    lines.join("\n")
}

fn append_tree_lines(node: &TreeNode, prefix: &str, lines: &mut Vec<String>) {
    let entries = node.children.iter().collect::<Vec<_>>();

    for (index, (name, child)) in entries.iter().enumerate() {
        let is_last = index == entries.len() - 1;
        let branch = if is_last { "└─ " } else { "├─ " };
        let next_prefix = format!("{}{}", prefix, if is_last { "   " } else { "│  " });
        let suffix = if child.is_file { "" } else { "/" };

        lines.push(format!("{prefix}{branch}{name}{suffix}"));

        if !child.is_file {
            append_tree_lines(child, &next_prefix, lines);
        }
    }
}
