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
const MAX_CONTEXT_CHARACTERS: usize = 400_000;
const MAX_FILE_CONTEXT_CHARACTERS: usize = 200_000;
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
        let contents = create_project_file_excerpt(
            &contents,
            remaining_characters.min(MAX_FILE_CONTEXT_CHARACTERS),
            &relative_path,
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
            | ".gitignore"
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
        ".md", ".txt", ".json", ".ts", ".tsx", ".js", ".jsx", ".css", ".html", ".py", ".pyi",
        ".rs", ".toml", ".yaml", ".yml",
    ]
    .into_iter()
    .map(String::from)
    .collect()
}

fn supported_file_names() -> HashSet<String> {
    [
        ".env.example",
        "dockerfile",
        "makefile",
        "package.json",
        "requirements.txt",
        "readme.md",
    ]
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
    let extension = Path::new(base_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");

    if base_name == "readme.md" {
        return 0;
    }

    if base_name == "package.json" {
        return 1;
    }

    if base_name == "pyproject.toml" || base_name == "requirements.txt" {
        return 2;
    }

    if normalized_path.ends_with("src/app.tsx")
        || normalized_path.ends_with("src/app.ts")
        || normalized_path.ends_with("src/app.jsx")
        || normalized_path.ends_with("src/app.js")
    {
        return 3;
    }

    if normalized_path.ends_with("src/app.css")
        || normalized_path.ends_with("src/index.css")
        || normalized_path.ends_with("src/main.css")
    {
        return 4;
    }

    if normalized_path.ends_with("src/main.tsx")
        || normalized_path.ends_with("src/main.ts")
        || normalized_path.ends_with("src/main.jsx")
        || normalized_path.ends_with("src/main.js")
        || normalized_path.ends_with("src/index.tsx")
        || normalized_path.ends_with("src/index.ts")
        || normalized_path.ends_with("src/index.jsx")
        || normalized_path.ends_with("src/index.js")
    {
        return 5;
    }

    if normalized_path.contains("/src/components/") {
        return 10;
    }

    if normalized_path.contains("/src/services/") {
        return 12;
    }

    if normalized_path.contains("/src/")
        && matches!(extension, "ts" | "tsx" | "js" | "jsx" | "css")
    {
        return 15;
    }

    if normalized_path.contains("/backend/") {
        return 20;
    }

    if normalized_path.contains("/src-tauri/src/") {
        return 25;
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

fn extract_css_blocks(text: &str) -> Vec<String> {
    let characters = text.char_indices().collect::<Vec<_>>();
    let mut blocks = Vec::new();
    let mut block_start = 0usize;
    let mut depth = 0usize;

    for (index, character) in characters {
        if character == '{' {
            depth += 1;
        } else if character == '}' {
            depth = depth.saturating_sub(1);

            if depth == 0 {
                let block_end = index + character.len_utf8();
                let block = text[block_start..block_end].trim();
                if !block.is_empty() {
                    blocks.push(block.to_string());
                }
                block_start = block_end;
            }
        }
    }

    blocks
}

fn sample_evenly(items: &[String], maximum: usize) -> Vec<&str> {
    let sample_count = items.len().min(maximum);

    (0..sample_count)
        .filter_map(|index| {
            let item_index = if sample_count <= 1 {
                0
            } else {
                index * (items.len() - 1) / (sample_count - 1)
            };

            items.get(item_index).map(String::as_str)
        })
        .collect()
}

fn build_css_index(text: &str) -> String {
    let entries = extract_css_blocks(text)
        .into_iter()
        .filter_map(|block| {
            let (selector, body) = block.split_once('{')?;
            let selector = selector
                .lines()
                .filter(|line| !line.trim().starts_with("/*"))
                .collect::<Vec<_>>()
                .join(" ")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");

            if selector.is_empty() || selector.starts_with('@') {
                return None;
            }

            let declaration = body
                .split(';')
                .find_map(|part| {
                    let (property, value) = part.split_once(':')?;
                    let property = property.trim();
                    let value = value.trim();

                    (!property.is_empty()
                        && !value.is_empty()
                        && property
                            .chars()
                            .all(|character| character.is_ascii_alphanumeric() || character == '-'))
                    .then(|| format!("{property}: {value}"))
                })?;

            Some(format!("{selector} -> {declaration}"))
        })
        .collect::<Vec<_>>();
    let sampled = sample_evenly(&entries, 40);

    if sampled.is_empty() {
        String::new()
    } else {
        format!(
            "[CSS selector index extracted from complete blocks]\n{}",
            sampled.join("\n")
        )
    }
}

fn extract_source_windows(text: &str, signal_terms: &[&str]) -> Vec<String> {
    let lines = text.lines().collect::<Vec<_>>();
    let signal_indexes = lines
        .iter()
        .enumerate()
        .filter_map(|(index, line)| {
            let normalized = line.to_lowercase();

            signal_terms
                .iter()
                .any(|term| normalized.contains(term))
                .then_some(index)
        })
        .map(|index| index.to_string())
        .collect::<Vec<_>>();

    sample_evenly(&signal_indexes, 14)
        .iter()
        .filter_map(|value| value.parse::<usize>().ok())
        .map(|index| {
            let start = index.saturating_sub(2);
            let end = (index + 4).min(lines.len());

            lines[start..end].join("\n").trim().to_string()
        })
        .collect()
}

fn build_source_index(text: &str, path: &str) -> String {
    if path.to_lowercase().ends_with(".css") {
        return build_css_index(text);
    }

    let mut callables = Vec::<(usize, String)>::new();
    let mut constant_declarations = Vec::<String>::new();
    let mut ui_labels = Vec::<String>::new();
    let lines = text.lines().collect::<Vec<_>>();
    let mut offset = 0usize;

    for line in &lines {
        let trimmed = line.trim();
        for marker in ["aria-label=\"", "placeholder=\""] {
            if let Some(start) = trimmed.find(marker) {
                let value_start = start + marker.len();
                if let Some(end) = trimmed[value_start..].find('"') {
                    let label = trimmed[value_start..value_start + end].trim();
                    if !label.is_empty() && !ui_labels.iter().any(|item| item == label) {
                        ui_labels.push(label.to_string());
                    }
                }
            }
        }
        let callable = trimmed
            .strip_prefix("function ")
            .or_else(|| trimmed.strip_prefix("fn "))
            .and_then(|rest| {
                rest.split(|character: char| {
                    !(character.is_ascii_alphanumeric() || character == '_')
                })
                .next()
            })
            .filter(|name| !name.is_empty())
            .map(str::to_string)
            .or_else(|| {
                let rest = trimmed.strip_prefix("const ")?;
                let (name, value) = rest.split_once('=')?;
                let value = value.trim_start();
                (value.starts_with("useCallback(")
                    || value.starts_with("async (")
                    || value.starts_with('('))
                .then(|| name.trim().to_string())
            });

        if let Some(name) = callable {
            callables.push((offset, name));
        }

        if let Some(rest) = trimmed.strip_prefix("const ") {
            if let Some((declaration, _)) = trimmed.split_once(';') {
                let name = rest
                    .split(|character: char| {
                        character == ':' || character == '=' || character.is_whitespace()
                    })
                    .next()
                    .unwrap_or_default();
                if !name.is_empty()
                    && name
                        .chars()
                        .all(|character| {
                            character.is_ascii_uppercase()
                                || character.is_ascii_digit()
                                || character == '_'
                        })
                {
                    constant_declarations.push(format!("{declaration};"));
                }
            }
        }

        offset += line.len() + 1;
    }

    let mut endpoints = Vec::new();
    for (index, _) in text.match_indices("/api/") {
        let endpoint = text[index..]
            .chars()
            .take_while(|character| {
                character.is_ascii_alphanumeric()
                    || matches!(character, '/' | '_' | '.' | '-' | ':' | '{' | '}')
            })
            .collect::<String>();
        let owner = callables
            .iter()
            .rev()
            .find(|(callable_index, _)| *callable_index < index)
            .map(|(_, name)| name.as_str())
            .unwrap_or("file scope");
        let location = format!("{owner} -> {endpoint}");

        if !endpoints.contains(&location) {
            endpoints.push(location);
        }
    }

    let mut callable_names = Vec::new();
    for (_, name) in callables {
        if !callable_names.contains(&name) {
            callable_names.push(name);
        }
    }

    if callable_names.is_empty()
        && constant_declarations.is_empty()
        && endpoints.is_empty()
        && ui_labels.is_empty()
    {
        return String::new();
    }

    let mut lines = vec!["[Source index extracted from the complete file]".to_string()];
    if !constant_declarations.is_empty() {
        lines.push(format!(
            "Verbatim constant declarations: {}",
            constant_declarations.join(" ")
        ));
    }
    if !callable_names.is_empty() {
        lines.push(format!("Named callables: {}", callable_names.join(", ")));
    }
    if !endpoints.is_empty() {
        lines.push(format!(
            "API paths by nearest callable: {}",
            endpoints.join("; ")
        ));
    }
    if !ui_labels.is_empty() {
        lines.push(format!(
            "Static UI labels: {}",
            ui_labels.into_iter().take(30).collect::<Vec<_>>().join(", ")
        ));
    }

    lines.join("\n")
}

fn create_project_file_excerpt(text: &str, max_characters: usize, path: &str) -> String {
    let source_index = build_source_index(text, path);
    let index_prefix = if source_index.is_empty() {
        String::new()
    } else {
        format!("{source_index}\n\n")
    };
    let prefix_characters = index_prefix.chars().count();
    let content_limit = max_characters.saturating_sub(prefix_characters);

    if text.chars().count() <= content_limit {
        return format!("{index_prefix}{text}");
    }

    const MARKER_BUDGET: usize = 120;
    let available_characters = content_limit.saturating_sub(MARKER_BUDGET);
    let head_budget = available_characters * 2 / 10;
    let signal_budget = available_characters * 6 / 10;
    let tail_budget = available_characters - head_budget - signal_budget;
    let is_css = path.to_lowercase().ends_with(".css");
    let source_signal_terms = [
        "import ",
        "export ",
        "type ",
        "interface ",
        "class ",
        "function ",
        "const ",
        "return (",
        "usestate(",
        "useeffect(",
        "usememo(",
        "usecallback(",
        "createcontext(",
        "fetch(",
        "invoke(",
        "onclick=",
        "onchange=",
        "onsubmit=",
        "aria-label=",
        "placeholder=",
        "classname=",
    ];
    let css_blocks = if is_css {
        extract_css_blocks(text)
    } else {
        Vec::new()
    };
    let source_windows = if is_css {
        Vec::new()
    } else {
        extract_source_windows(text, &source_signal_terms)
    };
    let sampled_signals = if is_css {
        sample_evenly(&css_blocks, 36).join("\n\n")
    } else {
        source_windows.join("\n\n")
    };
    let head = text.chars().take(head_budget).collect::<String>();
    let signals = sampled_signals
        .chars()
        .take(signal_budget)
        .collect::<String>();
    let tail = text
        .chars()
        .rev()
        .take(tail_budget)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();

    let excerpt = [
        "[Beginning of file]",
        &head,
        if is_css {
            "[Complete style blocks sampled across the file]"
        } else {
            "[Behavior and interface signals sampled across the file]"
        },
        &signals,
        "[End of file]",
        &tail,
    ]
    .join("\n\n");

    format!("{index_prefix}{excerpt}")
        .chars()
        .take(max_characters)
        .collect()
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
