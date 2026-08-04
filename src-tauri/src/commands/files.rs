use lofty::{
    file::{AudioFile, TaggedFileExt},
    tag::Accessor,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    hash::{Hash, Hasher},
    io::{Read, Seek, SeekFrom},
    path::{Component, Path, PathBuf},
};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

const MAX_FILE_SIZE: u64 = 200 * 1024;
const MAX_FILE_CONTEXT_CHARACTERS: usize = 200_000;
const MAX_SELECTIVE_READ_FILES: usize = 8;
const MAX_SELECTIVE_READ_CHARACTERS: usize = 60_000;
const MAX_LIVE_FOLDER_ENTRIES: usize = 2_000;
const MAX_TREE_ENTRIES: usize = 400;
const MAX_FILESYSTEM_OPERATIONS: usize = 250;
const ORGANIZATION_BATCH_SIZE: usize = 200;
const ORGANIZATION_PREVIEW_SIZE: usize = 30;
const MAX_CONTENT_SEARCH_RESULTS: usize = 50;
const MAX_CONTENT_SEARCH_FILE_SIZE: u64 = 256 * 1024;
const MAX_CONTENT_SEARCH_MATCHES_PER_FILE: usize = 5;
const MAX_WRITE_FILE_SIZE: usize = 512 * 1024;
const BACKUP_DIR_NAME: &str = ".spotlight-backup";

#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FilesystemAction {
    Move { from: String, to: String },
    Rename {
        path: String,
        #[serde(rename = "newName")]
        new_name: String,
    },
    CreateFolder { path: String },
    Delete { path: String },
    Copy { from: String, to: String },
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizationPlan {
    group_by: Vec<OrganizationGrouping>,
    scope: OrganizationScope,
    #[serde(default)]
    subfolder_path: Option<String>,
    #[serde(default)]
    remove_empty_folders: bool,
}

#[derive(Clone, Copy, Deserialize, Hash, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum OrganizationGrouping {
    FileType,
    Alphabet,
    Root,
}

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum OrganizationScope {
    AllFiles,
    Subfolder,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizationPreview {
    fingerprint: String,
    total_files: usize,
    planned_moves: usize,
    unchanged_files: usize,
    conflicts: usize,
    batch_count: usize,
    planned_folder_removals: usize,
    type_breakdown: BTreeMap<String, usize>,
    sample_actions: Vec<FilesystemAction>,
}

#[derive(Serialize)]
pub struct OperationResult {
    success: bool,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    backup_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFolderScan {
    root_name: String,
    root_path: String,
    files_found: usize,
    files_included: usize,
    files_ignored: usize,
    files_skipped: usize,
    total_bytes: u64,
    total_characters: usize,
    included_files: Vec<ProjectFolderFile>,
    live_entries: Vec<ProjectFolderEntry>,
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
pub struct ProjectFolderEntry {
    path: String,
    size: u64,
    modified_at: Option<u64>,
    readable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    path: String,
    name: String,
    kind: String,
    size: u64,
    modified_at: Option<u64>,
    readable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntryPage {
    entries: Vec<WorkspaceEntry>,
    next_cursor: Option<usize>,
    total_matches: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInspection {
    path: String,
    kind: String,
    size: u64,
    modified_at: Option<u64>,
    extension: String,
    readable_as_text: bool,
    audio_metadata: Option<AudioMetadata>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioMetadata {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    genre: Option<String>,
    track: Option<u32>,
    track_total: Option<u32>,
    disk: Option<u32>,
    disk_total: Option<u32>,
    duration_seconds: u64,
    audio_bitrate_kbps: Option<u32>,
    sample_rate_hz: Option<u32>,
    channels: Option<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileChunk {
    path: String,
    offset: u64,
    next_offset: Option<u64>,
    total_bytes: u64,
    content: String,
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

#[tauri::command]
pub fn refresh_project_folder(base_path: String) -> Result<ProjectFolderScan, String> {
    let root_path = fs::canonicalize(&base_path)
        .map_err(|error| format!("Could not open the selected folder: {error}"))?;
    if !root_path.is_dir() {
        return Err("The selected project path is not a folder".to_string());
    }

    scan_project_folder(root_path)
}

#[tauri::command]
pub fn read_project_files(
    base_path: String,
    paths: Vec<String>,
) -> Result<Vec<ProjectFolderFile>, String> {
    if paths.len() > MAX_SELECTIVE_READ_FILES {
        return Err(format!(
            "At most {MAX_SELECTIVE_READ_FILES} files can be read for one question"
        ));
    }

    let base = fs::canonicalize(&base_path)
        .map_err(|error| format!("Could not open the selected folder: {error}"))?;
    if !base.is_dir() {
        return Err("The selected project path is not a folder".to_string());
    }

    let mut results = Vec::with_capacity(paths.len());
    let mut seen = HashSet::new();
    let mut remaining_characters = MAX_SELECTIVE_READ_CHARACTERS;

    for value in paths {
        let relative = validate_relative_path(&value, "File path")?;
        let normalized = relative.to_string_lossy().replace('\\', "/");
        if !seen.insert(normalized.clone()) {
            continue;
        }
        if is_ignored_workspace_path(&relative) {
            return Err(format!("Ignored files cannot be read: {normalized}"));
        }

        let path = resolve_existing_path(&base, &normalized, "File")?;
        if !path.is_file() || !is_supported_project_file(&path) {
            return Err(format!("This file type is not readable: {normalized}"));
        }

        let metadata = fs::metadata(&path)
            .map_err(|error| format!("Could not inspect {normalized}: {error}"))?;
        if metadata.len() > MAX_FILE_SIZE {
            return Err(format!("File is too large to read: {normalized}"));
        }
        if remaining_characters == 0 {
            break;
        }

        let contents = fs::read_to_string(&path)
            .map_err(|error| format!("Could not read {normalized}: {error}"))?;
        let contents = clean_text(&contents);
        let excerpt = create_project_file_excerpt(
            &contents,
            remaining_characters.min(MAX_FILE_CONTEXT_CHARACTERS),
            &normalized,
        );
        remaining_characters = remaining_characters.saturating_sub(excerpt.chars().count());
        results.push(ProjectFolderFile {
            path: normalized,
            size: metadata.len(),
            contents: excerpt,
        });
    }

    Ok(results)
}

fn metadata_modified_at(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_secs())
}

fn workspace_entry(base: &Path, path: &Path, metadata: &fs::Metadata) -> WorkspaceEntry {
    let relative = path
        .strip_prefix(base)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    WorkspaceEntry {
        path: relative,
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_string(),
        kind: if metadata.is_dir() { "folder" } else { "file" }.to_string(),
        size: if metadata.is_file() { metadata.len() } else { 0 },
        modified_at: metadata_modified_at(metadata),
        readable: metadata.is_file()
            && is_supported_project_file(path)
            && metadata.len() <= MAX_FILE_SIZE,
    }
}

fn open_workspace_base(base_path: &str) -> Result<PathBuf, String> {
    let base = fs::canonicalize(base_path)
        .map_err(|error| format!("Could not open the selected folder: {error}"))?;
    if !base.is_dir() {
        return Err("The selected project path is not a folder".to_string());
    }
    Ok(base)
}

#[tauri::command]
pub fn browse_project_folder(
    base_path: String,
    relative_path: Option<String>,
    cursor: Option<usize>,
    limit: Option<usize>,
) -> Result<WorkspaceEntryPage, String> {
    let base = open_workspace_base(&base_path)?;
    let directory = match relative_path.as_deref().map(str::trim) {
        None | Some("") => base.clone(),
        Some(value) => {
            let path = resolve_existing_path(&base, value, "Folder")?;
            if !path.is_dir() {
                return Err(format!("Not a folder: {value}"));
            }
            path
        }
    };
    let mut entries = Vec::new();
    for entry in fs::read_dir(&directory)
        .map_err(|error| format!("Could not read {}: {error}", directory.display()))?
    {
        let entry = entry.map_err(|error| format!("Could not read folder entry: {error}"))?;
        let path = entry.path();
        let relative = path
            .strip_prefix(&base)
            .map_err(|_| "A folder entry escaped the selected folder".to_string())?;
        if is_ignored_workspace_path(relative) {
            continue;
        }
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        entries.push(workspace_entry(&base, &path, &metadata));
    }
    entries.sort_by(|left, right| {
        (left.kind != "folder")
            .cmp(&(right.kind != "folder"))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    paginate_workspace_entries(entries, cursor, limit)
}

fn collect_workspace_search_entries(
    base: &Path,
    directory: &Path,
    query_terms: &[String],
    matches: &mut Vec<WorkspaceEntry>,
) -> Result<(), String> {
    for entry in fs::read_dir(directory)
        .map_err(|error| format!("Could not read {}: {error}", directory.display()))?
    {
        let entry = entry.map_err(|error| format!("Could not read folder entry: {error}"))?;
        let path = entry.path();
        let relative = path
            .strip_prefix(base)
            .map_err(|_| "A search result escaped the selected folder".to_string())?;
        if is_ignored_workspace_path(relative) {
            continue;
        }
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        let normalized = relative.to_string_lossy().replace('\\', "/");
        let searchable = normalized.to_lowercase();
        if query_terms.iter().all(|term| searchable.contains(term)) {
            matches.push(workspace_entry(base, &path, &metadata));
        }
        if metadata.is_dir() {
            collect_workspace_search_entries(base, &path, query_terms, matches)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn search_project_folder(
    base_path: String,
    query: String,
    cursor: Option<usize>,
    limit: Option<usize>,
) -> Result<WorkspaceEntryPage, String> {
    let base = open_workspace_base(&base_path)?;
    let query_terms = query
        .split_whitespace()
        .map(str::to_lowercase)
        .filter(|term| !term.is_empty())
        .collect::<Vec<_>>();
    let mut entries = Vec::new();
    collect_workspace_search_entries(&base, &base, &query_terms, &mut entries)?;
    entries.sort_by(|left, right| left.path.to_lowercase().cmp(&right.path.to_lowercase()));
    paginate_workspace_entries(entries, cursor, limit)
}

fn paginate_workspace_entries(
    entries: Vec<WorkspaceEntry>,
    cursor: Option<usize>,
    limit: Option<usize>,
) -> Result<WorkspaceEntryPage, String> {
    let total_matches = entries.len();
    let start = cursor.unwrap_or(0);
    if start > total_matches {
        return Err("The folder cursor is no longer valid; start again at cursor 0".to_string());
    }
    let page_size = limit.unwrap_or(100).clamp(1, 200);
    let end = start.saturating_add(page_size).min(total_matches);
    let next_cursor = (end < total_matches).then_some(end);
    Ok(WorkspaceEntryPage {
        entries: entries.into_iter().skip(start).take(page_size).collect(),
        next_cursor,
        total_matches,
    })
}

fn is_supported_audio_metadata_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "aac"
            | "aiff"
            | "ape"
            | "flac"
            | "m4a"
            | "mp3"
            | "mp4"
            | "mpc"
            | "ogg"
            | "opus"
            | "spx"
            | "wav"
            | "wv"
    )
}

fn read_audio_metadata(path: &Path) -> Option<AudioMetadata> {
    if !is_supported_audio_metadata_file(path) {
        return None;
    }
    let tagged_file = lofty::read_from_path(path).ok()?;
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());
    let properties = tagged_file.properties();

    Some(AudioMetadata {
        title: tag.and_then(|value| value.title()).map(|value| value.into_owned()),
        artist: tag
            .and_then(|value| value.artist())
            .map(|value| value.into_owned()),
        album: tag.and_then(|value| value.album()).map(|value| value.into_owned()),
        genre: tag.and_then(|value| value.genre()).map(|value| value.into_owned()),
        track: tag.and_then(Accessor::track),
        track_total: tag.and_then(Accessor::track_total),
        disk: tag.and_then(Accessor::disk),
        disk_total: tag.and_then(Accessor::disk_total),
        duration_seconds: properties.duration().as_secs(),
        audio_bitrate_kbps: properties.audio_bitrate(),
        sample_rate_hz: properties.sample_rate(),
        channels: properties.channels(),
    })
}

#[tauri::command]
pub fn inspect_project_entries(
    base_path: String,
    paths: Vec<String>,
) -> Result<Vec<WorkspaceInspection>, String> {
    if paths.len() > 64 {
        return Err("At most 64 entries can be inspected in one batch".to_string());
    }
    let base = open_workspace_base(&base_path)?;
    let mut results = Vec::new();
    let mut seen = HashSet::new();
    for value in paths {
        let relative = validate_relative_path(&value, "Entry path")?;
        let normalized = relative.to_string_lossy().replace('\\', "/");
        if !seen.insert(normalized.clone()) {
            continue;
        }
        if is_ignored_workspace_path(&relative) {
            return Err(format!("Ignored entries cannot be inspected: {normalized}"));
        }
        let path = resolve_existing_path(&base, &normalized, "Entry")?;
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Could not inspect {normalized}: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err(format!("Symbolic links cannot be inspected: {normalized}"));
        }
        results.push(WorkspaceInspection {
            path: normalized,
            kind: if metadata.is_dir() { "folder" } else { "file" }.to_string(),
            size: if metadata.is_file() { metadata.len() } else { 0 },
            modified_at: metadata_modified_at(&metadata),
            extension: path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase(),
            readable_as_text: metadata.is_file()
                && is_supported_project_file(&path)
                && metadata.len() <= MAX_FILE_SIZE,
            audio_metadata: metadata.is_file()
                .then(|| read_audio_metadata(&path))
                .flatten(),
        });
    }
    Ok(results)
}

#[tauri::command]
pub fn read_project_file_chunk(
    base_path: String,
    path: String,
    offset: Option<u64>,
    max_bytes: Option<usize>,
) -> Result<WorkspaceFileChunk, String> {
    let base = open_workspace_base(&base_path)?;
    let relative = validate_relative_path(&path, "File path")?;
    let normalized = relative.to_string_lossy().replace('\\', "/");
    if is_ignored_workspace_path(&relative) {
        return Err(format!("Ignored files cannot be read: {normalized}"));
    }
    let file_path = resolve_existing_path(&base, &normalized, "File")?;
    if !file_path.is_file() || !is_supported_project_file(&file_path) {
        return Err(format!("This file type is not readable: {normalized}"));
    }
    let metadata = fs::metadata(&file_path)
        .map_err(|error| format!("Could not inspect {normalized}: {error}"))?;
    let total_bytes = metadata.len();
    let start = offset.unwrap_or(0);
    if start > total_bytes {
        return Err(format!(
            "The read offset {start} is past the end of {normalized}"
        ));
    }
    let requested = max_bytes.unwrap_or(16_000).clamp(1_000, 24_000);
    let mut file = fs::File::open(&file_path)
        .map_err(|error| format!("Could not open {normalized}: {error}"))?;
    file.seek(SeekFrom::Start(start))
        .map_err(|error| format!("Could not seek in {normalized}: {error}"))?;
    let remaining = total_bytes.saturating_sub(start);
    let read_length = (requested as u64).min(remaining) as usize;
    let mut buffer = vec![0_u8; read_length];
    file.read_exact(&mut buffer)
        .map_err(|error| format!("Could not read {normalized}: {error}"))?;

    let valid_length = match std::str::from_utf8(&buffer) {
        Ok(_) => buffer.len(),
        Err(error) if error.error_len().is_none() && error.valid_up_to() > 0 => error.valid_up_to(),
        Err(_) => return Err(format!("This text file is not valid UTF-8: {normalized}")),
    };
    let content = String::from_utf8(buffer[..valid_length].to_vec())
        .map_err(|_| format!("This text file is not valid UTF-8: {normalized}"))?;
    let next = start + valid_length as u64;

    Ok(WorkspaceFileChunk {
        path: normalized,
        offset: start,
        next_offset: (next < total_bytes).then_some(next),
        total_bytes,
        // Chunk boundaries are byte offsets into the source file. Preserve the
        // exact decoded text so consecutive chunks can be joined losslessly.
        content,
    })
}

enum PreparedAction {
    Move {
        source: PathBuf,
        destination: PathBuf,
    },
    Rename {
        source: PathBuf,
        destination: PathBuf,
    },
    CreateFolder {
        path: PathBuf,
    },
    Delete {
        path: PathBuf,
    },
    Copy {
        source: PathBuf,
        destination: PathBuf,
    },
}

impl PreparedAction {
    fn source(&self) -> Option<&Path> {
        match self {
            Self::Move { source, .. }
            | Self::Rename { source, .. }
            | Self::Copy { source, .. } => Some(source),
            Self::Delete { path } => Some(path),
            Self::CreateFolder { .. } => None,
        }
    }

    fn destination(&self) -> Option<&Path> {
        match self {
            Self::Move { destination, .. }
            | Self::Rename { destination, .. }
            | Self::Copy { destination, .. } => Some(destination),
            Self::CreateFolder { path } => Some(path),
            Self::Delete { .. } => None,
        }
    }
}

fn validate_relative_path(value: &str, label: &str) -> Result<PathBuf, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{label} cannot be empty"));
    }

    let path = Path::new(value);
    if path.is_absolute() {
        return Err(format!("{label} must be relative to the selected folder"));
    }

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(segment) => normalized.push(segment),
            Component::Prefix(_)
            | Component::RootDir
            | Component::ParentDir
            | Component::CurDir => {
                return Err(format!(
                    "{label} cannot use a drive, root, current-folder, or parent-folder segment"
                ));
            }
        }
    }

    if normalized.as_os_str().is_empty() {
        return Err(format!("{label} cannot point to the selected folder itself"));
    }

    Ok(normalized)
}

fn validate_file_name(value: &str) -> Result<PathBuf, String> {
    let path = validate_relative_path(value, "New name")?;
    if path.components().count() != 1 {
        return Err("New name must be a single file or folder name".to_string());
    }

    Ok(path)
}

fn path_exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

fn resolve_existing_path(base: &Path, value: &str, label: &str) -> Result<PathBuf, String> {
    let relative = validate_relative_path(value, label)?;
    let joined = base.join(relative);
    let metadata = fs::symlink_metadata(&joined)
        .map_err(|_| format!("{label} does not exist: {value}"))?;

    if metadata.file_type().is_symlink() {
        return Err(format!("{label} cannot be a symbolic link"));
    }

    let canonical = fs::canonicalize(&joined)
        .map_err(|error| format!("Could not verify {label}: {error}"))?;
    if canonical == base || !canonical.starts_with(base) {
        return Err(format!("{label} must stay inside the selected folder"));
    }

    Ok(joined)
}

fn resolve_destination_path(base: &Path, value: &str, label: &str) -> Result<PathBuf, String> {
    let relative = validate_relative_path(value, label)?;
    let destination = base.join(relative);

    let mut existing_ancestor = destination.as_path();
    while !path_exists(existing_ancestor) {
        existing_ancestor = existing_ancestor
            .parent()
            .ok_or_else(|| format!("Could not verify {label}"))?;
    }

    let canonical_ancestor = fs::canonicalize(existing_ancestor)
        .map_err(|error| format!("Could not verify {label}: {error}"))?;
    if !canonical_ancestor.starts_with(base) {
        return Err(format!("{label} must stay inside the selected folder"));
    }
    if path_exists(&destination) {
        return Err(format!("{label} already exists: {value}"));
    }

    Ok(destination)
}

fn prepare_action(base: &Path, action: FilesystemAction) -> Result<PreparedAction, String> {
    match action {
        FilesystemAction::Move { from, to } => {
            let source = resolve_existing_path(base, &from, "Move source")?;
            let destination = resolve_destination_path(base, &to, "Move destination")?;
            if source == destination || (source.is_dir() && destination.starts_with(&source)) {
                return Err("A folder cannot be moved into itself".to_string());
            }
            Ok(PreparedAction::Move {
                source,
                destination,
            })
        }
        FilesystemAction::Rename { path, new_name } => {
            let source = resolve_existing_path(base, &path, "Rename source")?;
            let new_name = validate_file_name(&new_name)?;
            let destination = source
                .parent()
                .ok_or_else(|| "Could not determine the rename destination".to_string())?
                .join(new_name);
            if path_exists(&destination) {
                return Err(format!(
                    "Rename destination already exists: {}",
                    destination.display()
                ));
            }
            Ok(PreparedAction::Rename {
                source,
                destination,
            })
        }
        FilesystemAction::CreateFolder { path } => Ok(PreparedAction::CreateFolder {
            path: resolve_destination_path(base, &path, "New folder")?,
        }),
        FilesystemAction::Delete { path } => Ok(PreparedAction::Delete {
            path: resolve_existing_path(base, &path, "Delete target")?,
        }),
        FilesystemAction::Copy { from, to } => {
            let source = resolve_existing_path(base, &from, "Copy source")?;
            let destination = resolve_destination_path(base, &to, "Copy destination")?;
            if source == destination || (source.is_dir() && destination.starts_with(&source)) {
                return Err("A folder cannot be copied into itself".to_string());
            }
            if source.is_dir() {
                verify_copy_tree(&source)?;
            }
            Ok(PreparedAction::Copy {
                source,
                destination,
            })
        }
    }
}

fn verify_copy_tree(source: &Path) -> Result<(), String> {
    for entry in fs::read_dir(source)
        .map_err(|error| format!("Could not read {}: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| format!("Could not read folder entry: {error}"))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "Copying symbolic links is not supported: {}",
                path.display()
            ));
        }
        if metadata.is_dir() {
            verify_copy_tree(&path)?;
        }
    }

    Ok(())
}

fn copy_directory(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir(destination)
        .map_err(|error| format!("Could not create {}: {error}", destination.display()))?;

    for entry in fs::read_dir(source)
        .map_err(|error| format!("Could not read {}: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| format!("Could not read folder entry: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let metadata = fs::symlink_metadata(&source_path)
            .map_err(|error| format!("Could not inspect {}: {error}", source_path.display()))?;

        if metadata.is_dir() {
            copy_directory(&source_path, &destination_path)?;
        } else {
            fs::copy(&source_path, &destination_path).map_err(|error| {
                format!(
                    "Could not copy {} to {}: {error}",
                    source_path.display(),
                    destination_path.display()
                )
            })?;
        }
    }

    Ok(())
}

fn execute_prepared_action(action: PreparedAction) -> Result<(), String> {
    match action {
        PreparedAction::Move {
            source,
            destination,
        }
        | PreparedAction::Rename {
            source,
            destination,
        } => {
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    format!("Could not create {}: {error}", parent.display())
                })?;
            }
            fs::rename(&source, &destination).map_err(|error| {
                format!(
                    "Could not move {} to {}: {error}",
                    source.display(),
                    destination.display()
                )
            })?;
        }
        PreparedAction::CreateFolder { path } => {
            fs::create_dir_all(&path)
                .map_err(|error| format!("Could not create {}: {error}", path.display()))?;
        }
        PreparedAction::Delete { path } => {
            if path.is_dir() {
                fs::remove_dir_all(&path)
                    .map_err(|error| format!("Could not delete {}: {error}", path.display()))?;
            } else {
                fs::remove_file(&path)
                    .map_err(|error| format!("Could not delete {}: {error}", path.display()))?;
            }
        }
        PreparedAction::Copy {
            source,
            destination,
        } => {
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    format!("Could not create {}: {error}", parent.display())
                })?;
            }

            let copy_result = if source.is_dir() {
                copy_directory(&source, &destination)
            } else {
                fs::copy(&source, &destination)
                    .map(|_| ())
                    .map_err(|error| {
                        format!(
                            "Could not copy {} to {}: {error}",
                            source.display(),
                            destination.display()
                        )
                    })
            };

            if let Err(error) = copy_result {
                if destination.is_dir() {
                    let _ = fs::remove_dir_all(&destination);
                } else if path_exists(&destination) {
                    let _ = fs::remove_file(&destination);
                }
                return Err(error);
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn execute_filesystem_operations(
    base_path: String,
    actions: Vec<FilesystemAction>,
    create_backup: Option<bool>,
) -> Result<OperationResult, String> {
    if actions.is_empty() {
        return Err("No file changes were provided".to_string());
    }
    if actions.len() > MAX_FILESYSTEM_OPERATIONS {
        return Err(format!(
            "A single proposal can contain at most {MAX_FILESYSTEM_OPERATIONS} changes"
        ));
    }

    let base = fs::canonicalize(&base_path)
        .map_err(|error| format!("Could not open the selected folder: {error}"))?;
    if !base.is_dir() {
        return Err("The selected project path is not a folder".to_string());
    }

    let action_count = actions.len();
    let mut prepared = Vec::with_capacity(action_count);
    let mut destinations = HashSet::new();

    for (index, action) in actions.into_iter().enumerate() {
        let prepared_action = prepare_action(&base, action)
            .map_err(|error| format!("Change {} is invalid: {error}", index + 1))?;
        if let Some(destination) = prepared_action.destination() {
            if !destinations.insert(destination.to_path_buf()) {
                return Err(format!(
                    "Change {} uses the same destination as another change",
                    index + 1
                ));
            }
        }
        prepared.push(prepared_action);
    }

    let sources = prepared
        .iter()
        .filter_map(PreparedAction::source)
        .map(Path::to_path_buf)
        .collect::<HashSet<_>>();
    if destinations.iter().any(|path| sources.contains(path)) {
        return Err(
            "One change depends on the result of another; apply those changes separately"
                .to_string(),
        );
    }

    // Optionally back up files that will be deleted before executing.
    let backup_path = if create_backup.unwrap_or(false) {
        let backup_dir = build_backup_dir_path(&base);
        let mut backed_up = false;
        for action in &prepared {
            if let PreparedAction::Delete { path } = action {
                if path.exists() {
                    backup_file_to_dir(&base, path, &backup_dir)?;
                    backed_up = true;
                }
            }
        }
        if backed_up {
            backup_dir
                .strip_prefix(&base)
                .ok()
                .map(|p| p.to_string_lossy().replace('\\', "/"))
        } else {
            None
        }
    } else {
        None
    };

    for (index, action) in prepared.into_iter().enumerate() {
        execute_prepared_action(action)
            .map_err(|error| format!("Change {} failed: {error}", index + 1))?;
    }

    Ok(OperationResult {
        success: true,
        message: format!(
            "Applied {action_count} file {}.",
            if action_count == 1 { "change" } else { "changes" }
        ),
        backup_path,
    })
}

#[derive(Clone)]
struct OrganizationFile {
    relative_path: String,
    size: u64,
    modified_at: u64,
}

struct OrganizationState {
    fingerprint: String,
    total_files: usize,
    unchanged_files: usize,
    conflicts: usize,
    planned_folder_removals: usize,
    type_breakdown: BTreeMap<String, usize>,
    moves: Vec<(String, String)>,
}

fn collect_organization_files(
    base: &Path,
    directory: &Path,
    files: &mut Vec<OrganizationFile>,
    directories: &mut Vec<String>,
    cleanup_blockers: &mut Vec<String>,
) -> Result<(), String> {
    let entries = fs::read_dir(directory)
        .map_err(|error| format!("Could not read {}: {error}", directory.display()))?;

    for entry in entries {
        let entry = entry.map_err(|error| format!("Could not read folder entry: {error}"))?;
        let path = entry.path();
        let relative = path
            .strip_prefix(base)
            .map_err(|_| "A scanned path escaped the selected folder".to_string())?;
        let normalized = relative.to_string_lossy().replace('\\', "/");
        if is_ignored_workspace_path(relative) {
            cleanup_blockers.push(normalized);
            continue;
        }

        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;
        if metadata.file_type().is_symlink() {
            cleanup_blockers.push(normalized);
            continue;
        }
        if metadata.is_dir() {
            directories.push(normalized);
            collect_organization_files(base, &path, files, directories, cleanup_blockers)?;
            continue;
        }
        if !metadata.is_file() {
            cleanup_blockers.push(normalized);
            continue;
        }

        files.push(OrganizationFile {
            relative_path: normalized,
            size: metadata.len(),
            modified_at: metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|value| value.as_secs())
                .unwrap_or(0),
        });
    }

    Ok(())
}

fn organization_file_type(path: &Path) -> String {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    match extension.as_str() {
        "mp1" | "mp2" | "mp3" | "wav" | "flac" | "m4a" | "m4b" | "m4p"
        | "aac" | "ogg" | "oga" | "wma" | "opus" | "aiff" | "aif" | "alac"
        | "ape" | "wv" | "tta" | "amr" | "ac3" | "dts" | "dsf" | "dff"
        | "mid" | "midi" | "kar" | "mka" | "ra" | "ram" | "spx" | "xm"
        | "mod" | "s3m" | "it" => "Audio".to_string(),
        "m3u" | "m3u8" | "pls" | "cue" | "xspf" => "Playlists".to_string(),
        "reason" | "rns" | "rsn" => "Audio Projects".to_string(),
        "mp4" | "mov" | "mkv" | "avi" | "wmv" | "webm" | "m4v" | "mpeg"
        | "mpg" | "3gp" | "3g2" => "Video".to_string(),
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "tif" | "tiff"
        | "heic" | "heif" | "svg" | "raw" | "dng" => "Images".to_string(),
        "pdf" | "doc" | "docx" | "txt" | "md" | "rtf" | "odt" | "epub" => {
            "Documents".to_string()
        }
        "xls" | "xlsx" | "csv" | "tsv" | "ods" => "Spreadsheets".to_string(),
        "ppt" | "pptx" | "key" | "odp" => "Presentations".to_string(),
        "zip" | "7z" | "rar" | "tar" | "gz" | "bz2" | "xz" | "cab" => {
            "Archives".to_string()
        }
        "ts" | "tsx" | "js" | "jsx" | "css" | "html" | "rs" | "py" | "java"
        | "c" | "cpp" | "h" | "hpp" | "go" | "swift" | "kt" | "json" | "toml"
        | "yaml" | "yml" | "xml" | "sql" | "sh" | "ps1" => "Code".to_string(),
        "exe" | "msi" | "appx" | "bat" | "cmd" | "com" => {
            "Applications".to_string()
        }
        "ttf" | "otf" | "woff" | "woff2" => "Fonts".to_string(),
        "lnk" | "url" => "Shortcuts".to_string(),
        "" => "No Extension".to_string(),
        other => format!("Other ({})", other.to_ascii_uppercase()),
    }
}

fn organization_alphabet_bucket(path: &Path) -> String {
    let name = path.file_name().and_then(|value| value.to_str()).unwrap_or("");
    match name.chars().find(|character| character.is_ascii_alphanumeric()) {
        Some(character) if character.is_ascii_digit() => "0-9".to_string(),
        Some(character) => character.to_ascii_uppercase().to_string(),
        None => "#".to_string(),
    }
}

fn organization_destination(file: &OrganizationFile, plan: &OrganizationPlan, prefix: &str) -> String {
    let source = Path::new(&file.relative_path);
    let mut destination = PathBuf::new();
    if !prefix.is_empty() {
        destination.push(prefix);
    }
    for grouping in &plan.group_by {
        match grouping {
            OrganizationGrouping::FileType => destination.push(organization_file_type(source)),
            OrganizationGrouping::Alphabet => {
                destination.push(organization_alphabet_bucket(source))
            }
            OrganizationGrouping::Root => {}
        }
    }
    if let Some(file_name) = source.file_name() {
        destination.push(file_name);
    }
    destination.to_string_lossy().replace('\\', "/")
}

fn build_organization_state(base: &Path, plan: &OrganizationPlan) -> Result<OrganizationState, String> {
    if plan.group_by.is_empty() {
        return Err("The organization plan needs at least one grouping level".to_string());
    }
    let unique_groups = plan.group_by.iter().copied().collect::<HashSet<_>>();
    if unique_groups.len() != plan.group_by.len() {
        return Err("The organization plan repeats a grouping level".to_string());
    }
    if plan.group_by.contains(&OrganizationGrouping::Root) && plan.group_by.len() != 1 {
        return Err("Moving files to the main folder cannot be combined with another hierarchy".to_string());
    }

    let (scan_root, scan_prefix) = match plan.scope {
        OrganizationScope::AllFiles => (base.to_path_buf(), String::new()),
        OrganizationScope::Subfolder => {
            let subfolder = plan.subfolder_path.as_deref()
                .ok_or_else(|| "Subfolder path is required for subfolder scope".to_string())?;
            let path = resolve_existing_path(base, subfolder, "Subfolder")?;
            if !path.is_dir() {
                return Err("The subfolder path is not a directory".to_string());
            }
            let normalized = validate_relative_path(subfolder, "Subfolder")?
                .to_string_lossy()
                .replace('\\', "/");
            (path, normalized)
        }
    };

    let mut files = Vec::new();
    let mut directories = Vec::new();
    let mut cleanup_blockers = Vec::new();
    collect_organization_files(
        base,
        &scan_root,
        &mut files,
        &mut directories,
        &mut cleanup_blockers,
    )?;
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    directories.sort();
    cleanup_blockers.sort();

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    for file in &files {
        file.relative_path.hash(&mut hasher);
        file.size.hash(&mut hasher);
        file.modified_at.hash(&mut hasher);
    }
    for directory in &directories {
        directory.hash(&mut hasher);
    }
    for blocker in &cleanup_blockers {
        blocker.hash(&mut hasher);
    }
    let fingerprint = format!("{:016x}", hasher.finish());
    let mut destinations = HashSet::new();
    let mut moves = Vec::new();
    let mut unchanged_files = 0usize;
    let mut conflicts = 0usize;
    let mut type_breakdown = BTreeMap::new();

    for file in &files {
        *type_breakdown
            .entry(organization_file_type(Path::new(&file.relative_path)))
            .or_insert(0) += 1;
        let destination = organization_destination(file, plan, &scan_prefix);
        if destination.eq_ignore_ascii_case(&file.relative_path) {
            unchanged_files += 1;
            continue;
        }

        let destination_key = destination.to_ascii_lowercase();
        if !destinations.insert(destination_key) || path_exists(&base.join(&destination)) {
            conflicts += 1;
            continue;
        }
        moves.push((file.relative_path.clone(), destination));
    }

    let move_destinations = moves
        .iter()
        .map(|(source, destination)| (source.as_str(), destination.as_str()))
        .collect::<HashMap<_, _>>();
    let final_file_paths = files
        .iter()
        .map(|file| {
            move_destinations
                .get(file.relative_path.as_str())
                .copied()
                .unwrap_or(file.relative_path.as_str())
        })
        .collect::<Vec<_>>();
    let occupied_paths = final_file_paths
        .iter()
        .copied()
        .chain(cleanup_blockers.iter().map(String::as_str))
        .collect::<Vec<_>>();
    let planned_folder_removals = if plan.remove_empty_folders {
        directories
            .iter()
            .filter(|directory| {
                let prefix = format!("{directory}/");
                !occupied_paths.iter().any(|path| path.starts_with(&prefix))
            })
            .count()
    } else {
        0
    };

    Ok(OrganizationState {
        fingerprint,
        total_files: files.len(),
        unchanged_files,
        conflicts,
        planned_folder_removals,
        type_breakdown,
        moves,
    })
}

#[tauri::command]
pub fn preview_organization_plan(
    base_path: String,
    plan: OrganizationPlan,
) -> Result<OrganizationPreview, String> {
    let base = fs::canonicalize(&base_path)
        .map_err(|error| format!("Could not open the selected folder: {error}"))?;
    if !base.is_dir() {
        return Err("The selected project path is not a folder".to_string());
    }
    let state = build_organization_state(&base, &plan)?;
    let planned_moves = state.moves.len();
    let sample_actions = state
        .moves
        .iter()
        .take(ORGANIZATION_PREVIEW_SIZE)
        .map(|(from, to)| FilesystemAction::Move {
            from: from.clone(),
            to: to.clone(),
        })
        .collect();

    Ok(OrganizationPreview {
        fingerprint: state.fingerprint,
        total_files: state.total_files,
        planned_moves,
        unchanged_files: state.unchanged_files,
        conflicts: state.conflicts,
        batch_count: planned_moves.div_ceil(ORGANIZATION_BATCH_SIZE),
        planned_folder_removals: state.planned_folder_removals,
        type_breakdown: state.type_breakdown,
        sample_actions,
    })
}

#[tauri::command]
pub fn execute_organization_plan(
    base_path: String,
    plan: OrganizationPlan,
    expected_fingerprint: String,
) -> Result<OperationResult, String> {
    let base = fs::canonicalize(&base_path)
        .map_err(|error| format!("Could not open the selected folder: {error}"))?;
    if !base.is_dir() {
        return Err("The selected project path is not a folder".to_string());
    }
    let state = build_organization_state(&base, &plan)?;
    if state.fingerprint != expected_fingerprint {
        return Err(
            "The folder changed after the preview. Review a fresh plan before applying it."
                .to_string(),
        );
    }
    let move_count = state.moves.len();
    let batch_count = move_count.div_ceil(ORGANIZATION_BATCH_SIZE);
    let mut applied: Vec<(PathBuf, PathBuf)> = Vec::with_capacity(move_count);

    for batch in state.moves.chunks(ORGANIZATION_BATCH_SIZE) {
        for (from, to) in batch {
            let source = match resolve_existing_path(&base, from, "Move source") {
                Ok(path) => path,
                Err(error) => {
                    rollback_organization_moves(&applied);
                    return Err(error);
                }
            };
            let destination = match resolve_destination_path(&base, to, "Move destination") {
                Ok(path) => path,
                Err(error) => {
                    rollback_organization_moves(&applied);
                    return Err(error);
                }
            };
            if let Some(parent) = destination.parent() {
                if let Err(error) = fs::create_dir_all(parent) {
                    rollback_organization_moves(&applied);
                    return Err(format!("Could not create {}: {error}", parent.display()));
                }
            }
            if let Err(error) = fs::rename(&source, &destination) {
                rollback_organization_moves(&applied);
                return Err(format!(
                    "Could not move {} to {}: {error}",
                    source.display(),
                    destination.display()
                ));
            }
            applied.push((source, destination));
        }
    }

    let removed_folder_count = if plan.remove_empty_folders {
        remove_empty_organization_folders(&base)
    } else {
        0
    };

    let skipped_message = if state.conflicts == 0 {
        String::new()
    } else {
        format!(
            " {} conflicting {} left unchanged.",
            state.conflicts,
            if state.conflicts == 1 { "file was" } else { "files were" }
        )
    };
    let cleanup_message = if plan.remove_empty_folders {
        format!(
            " Removed {removed_folder_count} empty {}.",
            if removed_folder_count == 1 { "folder" } else { "folders" }
        )
    } else {
        String::new()
    };
    let move_message = if move_count == 0 {
        "No files needed moving.".to_string()
    } else {
        format!(
            "Organized {move_count} files in {batch_count} {}.",
            if batch_count == 1 { "batch" } else { "batches" }
        )
    };
    Ok(OperationResult {
        success: true,
        message: format!("{move_message}{cleanup_message}{skipped_message}"),
        backup_path: None,
    })
}

fn collect_organization_cleanup_folders(
    base: &Path,
    directory: &Path,
    folders: &mut Vec<PathBuf>,
) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(relative) = path.strip_prefix(base) else {
            continue;
        };
        if is_ignored_workspace_path(relative) {
            continue;
        }
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            continue;
        }
        collect_organization_cleanup_folders(base, &path, folders);
        folders.push(path);
    }
}

fn remove_empty_organization_folders(base: &Path) -> usize {
    let mut folders = Vec::new();
    collect_organization_cleanup_folders(base, base, &mut folders);
    folders
        .into_iter()
        // remove_dir only succeeds for an empty directory. Files and non-empty
        // folders can never be removed by this cleanup pass.
        .filter(|folder| fs::remove_dir(folder).is_ok())
        .count()
}

fn rollback_organization_moves(applied: &[(PathBuf, PathBuf)]) {
    for (source, destination) in applied.iter().rev() {
        if let Some(parent) = source.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::rename(destination, source);
    }
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
    let mut readable_files = 0usize;
    let mut live_entries = Vec::new();
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
        &mut readable_files,
        &mut live_entries,
        &mut skipped_files,
        &mut tree_paths,
    )?;

    Ok(ProjectFolderScan {
        root_name: root_name.clone(),
        root_path: root_path.to_string_lossy().into_owned(),
        files_found,
        files_included: readable_files,
        files_ignored,
        files_skipped,
        total_bytes,
        total_characters: 0,
        tree: format_file_tree(&tree_paths, &root_name),
        included_files: Vec::new(),
        live_entries,
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
    readable_files: &mut usize,
    live_entries: &mut Vec<ProjectFolderEntry>,
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
                readable_files,
                live_entries,
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

        let metadata = fs::metadata(&path)
            .map_err(|error| format!("Could not read file metadata: {error}"))?;
        // Keep the aggregate size accurate even when the live metadata list
        // reaches its review cap. Browsing/searching can still reach the rest.
        *total_bytes += metadata.len();
        if live_entries.len() >= MAX_LIVE_FOLDER_ENTRIES {
            *files_skipped += 1;
            skipped_files.push(SkippedFolderFile {
                path: relative_path.clone(),
                reason: SkippedReason::ContextLimit,
            });
            tree_paths.push(relative_path);
            continue;
        }

        let readable = is_supported_project_file(&path) && metadata.len() <= MAX_FILE_SIZE;
        if readable {
            *readable_files += 1;
        } else {
            *files_skipped += 1;
            skipped_files.push(SkippedFolderFile {
                path: relative_path.clone(),
                reason: if metadata.len() > MAX_FILE_SIZE {
                    SkippedReason::TooLarge
                } else {
                    SkippedReason::Unsupported
                },
            });
        }

        tree_paths.push(relative_path.clone());
        live_entries.push(ProjectFolderEntry {
            path: relative_path,
            size: metadata.len(),
            modified_at: metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as u64),
            readable,
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
        relative
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

fn is_ignored_workspace_path(path: &Path) -> bool {
    let ignored_directories = ignored_directory_names();
    path.components().any(|component| {
        let name = component.as_os_str().to_string_lossy().to_lowercase();
        ignored_directories.contains(&name)
    }) || is_ignored_file(path)
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
        ".bat", ".c", ".conf", ".cpp", ".cs", ".csv", ".go", ".h", ".html", ".ini",
        ".java", ".js", ".json", ".jsx", ".kt", ".log", ".md", ".ps1", ".py", ".pyi",
        ".rs", ".sh", ".sql", ".swift", ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml",
        ".yml", ".css",
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

// ─── Backup helpers ──────────────────────────────────────────────────────────

fn build_backup_dir_path(base: &Path) -> PathBuf {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    base.join(BACKUP_DIR_NAME).join(timestamp.to_string())
}

fn backup_file_to_dir(base: &Path, file_path: &Path, backup_dir: &Path) -> Result<(), String> {
    let relative = file_path
        .strip_prefix(base)
        .map_err(|_| "Could not compute backup path".to_string())?;
    let backup_target = backup_dir.join(relative);

    if let Some(parent) = backup_target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create backup directory: {e}"))?;
    }

    if file_path.is_dir() {
        copy_directory(file_path, &backup_target)
    } else {
        fs::copy(file_path, &backup_target)
            .map(|_| ())
            .map_err(|e| format!("Could not back up {}: {e}", file_path.display()))
    }
}

fn restore_from_backup(
    base: &Path,
    backup_root: &Path,
    current_dir: &Path,
    restored_count: &mut usize,
) -> Result<(), String> {
    for entry in fs::read_dir(current_dir)
        .map_err(|e| format!("Could not read backup directory: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Could not read backup entry: {e}"))?;
        let path = entry.path();
        let relative = path
            .strip_prefix(backup_root)
            .map_err(|_| "Backup entry escaped backup directory".to_string())?;
        let restore_target = base.join(relative);
        let metadata = fs::symlink_metadata(&path)
            .map_err(|e| format!("Could not inspect backup entry: {e}"))?;

        if metadata.is_dir() {
            restore_from_backup(base, backup_root, &path, restored_count)?;
        } else if metadata.is_file() {
            if let Some(parent) = restore_target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Could not create restore directory: {e}"))?;
            }
            fs::copy(&path, &restore_target)
                .map_err(|e| format!("Could not restore {}: {e}", relative.display()))?;
            *restored_count += 1;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn undo_filesystem_operation(
    base_path: String,
    backup_path: String,
) -> Result<OperationResult, String> {
    let base = open_workspace_base(&base_path)?;
    let backup_relative = validate_relative_path(&backup_path, "Backup path")?;
    let backup_dir = base.join(&backup_relative);

    if !backup_dir.is_dir() {
        return Err("Backup directory not found".to_string());
    }

    // Ensure backup dir is inside .spotlight-backup
    let first_component = backup_relative
        .components()
        .next()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .unwrap_or_default();
    if first_component != BACKUP_DIR_NAME {
        return Err("Invalid backup path".to_string());
    }

    let canonical_backup = fs::canonicalize(&backup_dir)
        .map_err(|e| format!("Could not verify backup path: {e}"))?;
    if !canonical_backup.starts_with(&base) {
        return Err("Backup path must stay inside the selected folder".to_string());
    }

    let mut restored_count = 0usize;
    restore_from_backup(&base, &backup_dir, &backup_dir, &mut restored_count)?;
    let _ = fs::remove_dir_all(&backup_dir);

    Ok(OperationResult {
        success: true,
        message: format!(
            "Restored {} file{}.",
            restored_count,
            if restored_count == 1 { "" } else { "s" }
        ),
        backup_path: None,
    })
}

// ─── Full-text content search ────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchMatch {
    line: usize,
    snippet: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchResult {
    path: String,
    size: u64,
    matches: Vec<ContentSearchMatch>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchPage {
    results: Vec<ContentSearchResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_cursor: Option<usize>,
    total_files_searched: usize,
}

fn search_file_for_terms(
    path: &Path,
    query_terms: &[String],
    case_sensitive: bool,
) -> Option<Vec<ContentSearchMatch>> {
    let content = fs::read_to_string(path).ok()?;
    let mut matches = Vec::new();

    for (line_idx, line) in content.lines().enumerate() {
        let searchable = if case_sensitive {
            line.to_string()
        } else {
            line.to_lowercase()
        };

        if query_terms.iter().all(|term| searchable.contains(term.as_str())) {
            let snippet = line.trim().chars().take(200).collect::<String>();
            matches.push(ContentSearchMatch {
                line: line_idx + 1,
                snippet,
            });
            if matches.len() >= MAX_CONTENT_SEARCH_MATCHES_PER_FILE {
                break;
            }
        }
    }

    if matches.is_empty() { None } else { Some(matches) }
}

fn collect_content_search(
    base: &Path,
    directory: &Path,
    query_terms: &[String],
    case_sensitive: bool,
    results: &mut Vec<ContentSearchResult>,
) -> Result<(), String> {
    if results.len() >= MAX_CONTENT_SEARCH_RESULTS {
        return Ok(());
    }

    for entry in fs::read_dir(directory)
        .map_err(|e| format!("Could not read {}: {e}", directory.display()))?
    {
        let entry = entry.map_err(|e| format!("Could not read entry: {e}"))?;
        let path = entry.path();
        let relative = path
            .strip_prefix(base)
            .map_err(|_| "A result escaped the selected folder".to_string())?;

        if is_ignored_workspace_path(relative) {
            continue;
        }

        let metadata = fs::symlink_metadata(&path)
            .map_err(|e| format!("Could not inspect {}: {e}", path.display()))?;
        if metadata.file_type().is_symlink() {
            continue;
        }

        if metadata.is_dir() {
            collect_content_search(base, &path, query_terms, case_sensitive, results)?;
            continue;
        }

        if !metadata.is_file()
            || metadata.len() > MAX_CONTENT_SEARCH_FILE_SIZE
            || !is_supported_project_file(&path)
        {
            continue;
        }

        if results.len() >= MAX_CONTENT_SEARCH_RESULTS {
            break;
        }

        let normalized = relative.to_string_lossy().replace('\\', "/");
        if let Some(matches) = search_file_for_terms(&path, query_terms, case_sensitive) {
            results.push(ContentSearchResult {
                path: normalized,
                size: metadata.len(),
                matches,
            });
        }
    }
    Ok(())
}

#[tauri::command]
pub fn search_project_file_contents(
    base_path: String,
    query: String,
    case_sensitive: Option<bool>,
    cursor: Option<usize>,
    limit: Option<usize>,
) -> Result<ContentSearchPage, String> {
    let base = open_workspace_base(&base_path)?;
    let sensitive = case_sensitive.unwrap_or(false);
    let query_terms: Vec<String> = query
        .split_whitespace()
        .map(|term| if sensitive { term.to_string() } else { term.to_lowercase() })
        .filter(|term| !term.is_empty())
        .collect();

    if query_terms.is_empty() {
        return Err("Search query cannot be empty".to_string());
    }

    let mut all_results = Vec::new();
    collect_content_search(&base, &base, &query_terms, sensitive, &mut all_results)?;

    let total = all_results.len();
    let start = cursor.unwrap_or(0);
    if start > total {
        return Err("The search cursor is no longer valid; start again at cursor 0".to_string());
    }
    let page_size = limit.unwrap_or(20).clamp(1, 50);
    let end = (start + page_size).min(total);
    let next_cursor = (end < total).then_some(end);

    Ok(ContentSearchPage {
        results: all_results.into_iter().skip(start).take(page_size).collect(),
        next_cursor,
        total_files_searched: total,
    })
}

// ─── Write project file ───────────────────────────────────────────────────────

#[tauri::command]
pub fn write_project_file(
    base_path: String,
    path: String,
    content: String,
) -> Result<OperationResult, String> {
    if content.len() > MAX_WRITE_FILE_SIZE {
        return Err(format!(
            "File content exceeds the maximum allowed size of {} KB",
            MAX_WRITE_FILE_SIZE / 1024
        ));
    }

    let base = fs::canonicalize(&base_path)
        .map_err(|e| format!("Could not open the selected folder: {e}"))?;
    if !base.is_dir() {
        return Err("The selected project path is not a folder".to_string());
    }

    let relative = validate_relative_path(&path, "File path")?;
    let normalized = relative.to_string_lossy().replace('\\', "/");

    if is_ignored_workspace_path(&relative) {
        return Err(format!("Ignored paths cannot be written: {normalized}"));
    }

    let file_path = base.join(&relative);

    // Verify the resolved path stays within base by checking the first
    // existing ancestor.
    let mut existing_ancestor = file_path.parent()
        .ok_or_else(|| "Could not determine parent directory".to_string())?;
    while !path_exists(existing_ancestor) {
        existing_ancestor = existing_ancestor
            .parent()
            .ok_or_else(|| "Could not verify file path".to_string())?;
    }
    let canonical_ancestor = fs::canonicalize(existing_ancestor)
        .map_err(|e| format!("Could not verify file path: {e}"))?;
    if !canonical_ancestor.starts_with(&base) {
        return Err("File path must stay inside the selected folder".to_string());
    }

    let file_exists = path_exists(&file_path);

    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create parent directories: {e}"))?;
    }

    fs::write(&file_path, content.as_bytes())
        .map_err(|e| format!("Could not write {normalized}: {e}"))?;

    Ok(OperationResult {
        success: true,
        message: if file_exists {
            format!("Updated {normalized}.")
        } else {
            format!("Created {normalized}.")
        },
        backup_path: None,
    })
}

// ─── Reference-aware rename ──────────────────────────────────────────────────

fn update_references_in_folder(
    base: &Path,
    directory: &Path,
    old_relative: &str,
    new_relative: &str,
    old_stem: &str,
    new_stem: &str,
    skip_file: &Path,
    updated_files: &mut usize,
    total_replacements: &mut usize,
) -> Result<(), String> {
    for entry in fs::read_dir(directory)
        .map_err(|e| format!("Could not read directory: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Could not read entry: {e}"))?;
        let path = entry.path();

        if path == skip_file {
            continue;
        }

        let relative = path
            .strip_prefix(base)
            .map_err(|_| "An entry escaped the selected folder".to_string())?;

        if is_ignored_workspace_path(relative) {
            continue;
        }

        let metadata = fs::symlink_metadata(&path)
            .map_err(|e| format!("Could not inspect {}: {e}", path.display()))?;
        if metadata.file_type().is_symlink() {
            continue;
        }

        if metadata.is_dir() {
            update_references_in_folder(
                base, &path, old_relative, new_relative, old_stem, new_stem,
                skip_file, updated_files, total_replacements,
            )?;
            continue;
        }

        if !metadata.is_file()
            || metadata.len() > MAX_CONTENT_SEARCH_FILE_SIZE
            || !is_supported_project_file(&path)
        {
            continue;
        }

        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let mut new_content = content.clone();
        let mut count = 0usize;

        // Replace full relative path references
        if new_content.contains(old_relative) {
            count += new_content.matches(old_relative).count();
            new_content = new_content.replace(old_relative, new_relative);
        }

        // Replace stem references in import/require/use contexts (only when stem changed)
        if old_stem != new_stem {
            // Match stem at end of quoted path (e.g. "./old-name" or "../path/old-name")
            let old_quoted_end = format!("{old_stem}\"");
            let new_quoted_end = format!("{new_stem}\"");
            let old_apos_end = format!("{old_stem}'");
            let new_apos_end = format!("{new_stem}'");

            let c1 = new_content.matches(&old_quoted_end).count();
            let c2 = new_content.matches(&old_apos_end).count();
            if c1 + c2 > 0 {
                new_content = new_content
                    .replace(&old_quoted_end, &new_quoted_end)
                    .replace(&old_apos_end, &new_apos_end);
                count += c1 + c2;
            }
        }

        if count > 0 {
            fs::write(&path, new_content.as_bytes())
                .map_err(|e| format!("Could not update {}: {e}", path.display()))?;
            *updated_files += 1;
            *total_replacements += count;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn rename_with_references(
    base_path: String,
    path: String,
    new_name: String,
) -> Result<OperationResult, String> {
    let base = fs::canonicalize(&base_path)
        .map_err(|e| format!("Could not open the selected folder: {e}"))?;
    if !base.is_dir() {
        return Err("The selected project path is not a folder".to_string());
    }

    let source = resolve_existing_path(&base, &path, "File path")?;
    let new_name_validated = validate_file_name(&new_name)?;
    let destination = source
        .parent()
        .ok_or_else(|| "Could not determine rename destination".to_string())?
        .join(&new_name_validated);

    if path_exists(&destination) {
        return Err(format!(
            "A file named \"{}\" already exists in that location",
            new_name
        ));
    }

    // Compute relative paths for reference replacement
    let old_relative = source
        .strip_prefix(&base)
        .map_err(|_| "Source path is not inside the selected folder".to_string())?
        .to_string_lossy()
        .replace('\\', "/");

    let new_relative = destination
        .strip_prefix(&base)
        .map_err(|_| "Destination path is not inside the selected folder".to_string())?
        .to_string_lossy()
        .replace('\\', "/");

    let old_stem = source
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let new_stem = destination
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

    // Update references in all text files before renaming
    let mut updated_files = 0usize;
    let mut total_replacements = 0usize;
    update_references_in_folder(
        &base,
        &base,
        &old_relative,
        &new_relative,
        &old_stem,
        &new_stem,
        &source,
        &mut updated_files,
        &mut total_replacements,
    )?;

    // Perform the rename
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create parent directories: {e}"))?;
    }
    fs::rename(&source, &destination)
        .map_err(|e| format!("Could not rename file: {e}"))?;

    let ref_message = if updated_files > 0 {
        format!(
            " Updated {} reference{} in {} file{}.",
            total_replacements,
            if total_replacements == 1 { "" } else { "s" },
            updated_files,
            if updated_files == 1 { "" } else { "s" },
        )
    } else {
        String::new()
    };

    Ok(OperationResult {
        success: true,
        message: format!("Renamed to \"{new_name}\".{ref_message}"),
        backup_path: None,
    })
}

#[cfg(test)]
mod filesystem_operation_tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn create_test_folder() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after the Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "desktop-spotlight-filesystem-test-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir(&path).expect("test folder should be created");
        path
    }

    fn apply(base: &Path, action: FilesystemAction) {
        execute_filesystem_operations(base.to_string_lossy().into_owned(), vec![action], None)
            .expect("operation should succeed");
    }

    #[test]
    fn validates_relative_paths() {
        assert_eq!(
            validate_relative_path("src/main.rs", "Path").unwrap(),
            PathBuf::from("src/main.rs")
        );
        assert!(validate_relative_path("../outside.txt", "Path").is_err());
        assert!(validate_relative_path("C:\\outside.txt", "Path").is_err());
        assert!(validate_relative_path(".", "Path").is_err());
        assert!(validate_relative_path("", "Path").is_err());
        assert!(validate_file_name("nested/name.txt").is_err());
    }

    #[test]
    fn applies_each_supported_operation_inside_the_selected_folder() {
        let root = create_test_folder();
        fs::write(root.join("note.txt"), "hello").expect("fixture should be written");

        apply(
            &root,
            FilesystemAction::CreateFolder {
                path: "organized".to_string(),
            },
        );
        apply(
            &root,
            FilesystemAction::Copy {
                from: "note.txt".to_string(),
                to: "organized/copy.txt".to_string(),
            },
        );
        apply(
            &root,
            FilesystemAction::Rename {
                path: "organized/copy.txt".to_string(),
                new_name: "renamed.txt".to_string(),
            },
        );
        apply(
            &root,
            FilesystemAction::Move {
                from: "note.txt".to_string(),
                to: "organized/moved.txt".to_string(),
            },
        );
        apply(
            &root,
            FilesystemAction::Delete {
                path: "organized/renamed.txt".to_string(),
            },
        );

        assert!(root.join("organized/moved.txt").is_file());
        assert!(!root.join("note.txt").exists());
        assert!(!root.join("organized/renamed.txt").exists());
        fs::remove_dir_all(root).expect("test folder should be removed");
    }

    #[test]
    fn applies_a_reviewed_seventy_two_song_plan() {
        let root = create_test_folder();
        let artists = [
            "Aurora Vale",
            "Copper Static",
            "Juniper Sky",
            "Midnight Relay",
            "Paper Satellites",
            "Velvet Circuit",
        ];
        let mut actions = artists
            .iter()
            .map(|artist| FilesystemAction::CreateFolder {
                path: artist.to_string(),
            })
            .collect::<Vec<_>>();

        for artist in artists {
            for track in 1..=12 {
                let file_name = format!("{artist} - {track:02} - Track {track:02}.mp3");
                fs::write(root.join(&file_name), [0_u8; 8])
                    .expect("song fixture should be written");
                actions.push(FilesystemAction::Move {
                    from: file_name.clone(),
                    to: format!("{artist}/{file_name}"),
                });
            }
        }

        let result = execute_filesystem_operations(
            root.to_string_lossy().into_owned(),
            actions,
            None,
        )
        .expect("the large reviewed plan should succeed");

        assert!(result.success);
        for artist in artists {
            for track in 1..=12 {
                let file_name = format!("{artist} - {track:02} - Track {track:02}.mp3");
                assert!(root.join(artist).join(file_name).is_file());
            }
        }
        fs::remove_dir_all(root).expect("test folder should be removed");
    }

    #[test]
    fn browses_searches_and_reads_the_live_tree_in_batches() {
        let root = create_test_folder();
        fs::create_dir_all(root.join("library/album"))
            .expect("nested fixture folder should be created");
        for track in 1..=72 {
            fs::write(
                root.join(format!("library/album/Artist - {track:02}.mp3")),
                [0_u8; 8],
            )
            .expect("song fixture should be written");
        }
        fs::write(root.join("library/notes.txt"), "current live notes")
            .expect("text fixture should be written");
        let large_text = "🙂 batch reading keeps the live file authoritative\n".repeat(2_000);
        fs::write(root.join("library/large.md"), &large_text)
            .expect("large text fixture should be written");
        fs::create_dir(root.join("node_modules")).expect("ignored folder should be created");
        fs::write(root.join("node_modules/hidden.js"), "ignored")
            .expect("ignored fixture should be written");
        let base = root.to_string_lossy().into_owned();

        let root_page = browse_project_folder(base.clone(), None, Some(0), Some(20))
            .expect("root browse should succeed");
        assert!(root_page.entries.iter().any(|entry| entry.path == "library"));
        assert!(!root_page
            .entries
            .iter()
            .any(|entry| entry.path.contains("node_modules")));

        let first_page = search_project_folder(
            base.clone(),
            ".mp3".to_string(),
            Some(0),
            Some(25),
        )
        .expect("first search page should succeed");
        assert_eq!(first_page.total_matches, 72);
        assert_eq!(first_page.entries.len(), 25);
        assert_eq!(first_page.next_cursor, Some(25));
        let last_page = search_project_folder(
            base.clone(),
            ".mp3".to_string(),
            Some(50),
            Some(25),
        )
        .expect("last search page should succeed");
        assert_eq!(last_page.entries.len(), 22);
        assert_eq!(last_page.next_cursor, None);

        let inspection = inspect_project_entries(
            base.clone(),
            vec!["library/album/Artist - 01.mp3".to_string()],
        )
        .expect("metadata inspection should succeed");
        assert_eq!(inspection[0].extension, "mp3");
        assert!(!inspection[0].readable_as_text);
        assert!(inspection[0].audio_metadata.is_none());
        let text = read_project_files(base, vec!["library/notes.txt".to_string()])
            .expect("live text read should succeed");
        assert!(text[0].contents.contains("current live notes"));

        let base = root.to_string_lossy().into_owned();
        let mut offset = 0_u64;
        let mut reconstructed = String::new();
        loop {
            let chunk = read_project_file_chunk(
                base.clone(),
                "library/large.md".to_string(),
                Some(offset),
                Some(1_001),
            )
            .expect("large text chunk should be read");
            reconstructed.push_str(&chunk.content);
            match chunk.next_offset {
                Some(next) => offset = next,
                None => break,
            }
        }
        assert_eq!(reconstructed, large_text);

        fs::remove_dir_all(root).expect("test folder should be removed");
    }

    #[test]
    fn expands_nested_type_then_alphabet_rules_and_rejects_stale_previews() {
        let root = create_test_folder();
        fs::create_dir_all(root.join("incoming/nested"))
            .expect("nested fixture folder should be created");
        fs::write(root.join("incoming/Amber Song.mp3"), [0_u8; 8])
            .expect("song fixture should be written");
        fs::write(root.join("incoming/Acoustic Book.m4b"), [0_u8; 8])
            .expect("audio-book fixture should be written");
        fs::write(root.join("incoming/nested/Battle Theme.wem"), [0_u8; 8])
            .expect("unknown audio-container fixture should be written");
        fs::write(root.join("incoming/nested/Bravo Notes.txt"), "notes")
            .expect("document fixture should be written");
        let base = root.to_string_lossy().into_owned();
        let plan = OrganizationPlan {
            group_by: vec![
                OrganizationGrouping::FileType,
                OrganizationGrouping::Alphabet,
            ],
            scope: OrganizationScope::AllFiles,
            subfolder_path: None,
            remove_empty_folders: false,
        };

        let preview = preview_organization_plan(base.clone(), plan.clone())
            .expect("organization preview should succeed");
        assert_eq!(preview.planned_moves, 4);
        assert_eq!(preview.type_breakdown.get("Audio"), Some(&2));
        assert_eq!(preview.type_breakdown.get("Documents"), Some(&1));
        assert_eq!(preview.type_breakdown.get("Other (WEM)"), Some(&1));
        assert!(preview.sample_actions.iter().any(|action| matches!(
            action,
            FilesystemAction::Move { from, to }
                if from == "incoming/Amber Song.mp3" && to == "Audio/A/Amber Song.mp3"
        )));
        assert!(preview.sample_actions.iter().any(|action| matches!(
            action,
            FilesystemAction::Move { from, to }
                if from == "incoming/nested/Battle Theme.wem"
                    && to == "Other (WEM)/B/Battle Theme.wem"
        )));

        fs::write(root.join("new-file.md"), "folder changed")
            .expect("new fixture should be written");
        assert!(execute_organization_plan(
            base.clone(),
            plan.clone(),
            preview.fingerprint,
        )
        .is_err());

        let fresh = preview_organization_plan(base.clone(), plan.clone())
            .expect("fresh preview should succeed");
        execute_organization_plan(base, plan, fresh.fingerprint)
            .expect("fresh organization plan should succeed");
        assert!(root.join("Audio/A/Amber Song.mp3").is_file());
        assert!(root.join("Audio/A/Acoustic Book.m4b").is_file());
        assert!(root.join("Documents/B/Bravo Notes.txt").is_file());
        assert!(root.join("Documents/N/new-file.md").is_file());
        assert!(root.join("Other (WEM)/B/Battle Theme.wem").is_file());
        assert!(root.join("incoming").is_dir());
        assert!(root.join("incoming/nested").is_dir());

        fs::remove_dir_all(root).expect("test folder should be removed");
    }

    #[test]
    fn applies_safe_organization_moves_while_leaving_conflicts_unchanged() {
        let root = create_test_folder();
        fs::create_dir_all(root.join("incoming"))
            .expect("incoming fixture folder should be created");
        fs::create_dir_all(root.join("Audio/A"))
            .expect("organized fixture folder should be created");
        fs::write(root.join("incoming/Alpha.mp3"), [1_u8; 8])
            .expect("conflicting fixture should be written");
        fs::write(root.join("Audio/A/Alpha.mp3"), [2_u8; 8])
            .expect("destination fixture should be written");
        fs::write(root.join("incoming/Beta.flac"), [3_u8; 8])
            .expect("safe fixture should be written");
        let base = root.to_string_lossy().into_owned();
        let plan = OrganizationPlan {
            group_by: vec![
                OrganizationGrouping::FileType,
                OrganizationGrouping::Alphabet,
            ],
            scope: OrganizationScope::AllFiles,
            subfolder_path: None,
            remove_empty_folders: false,
        };

        let preview = preview_organization_plan(base.clone(), plan.clone())
            .expect("preview with a conflict should succeed");
        assert_eq!(preview.conflicts, 1);
        assert_eq!(preview.planned_moves, 1);
        let result = execute_organization_plan(base, plan, preview.fingerprint)
            .expect("safe moves should still be applied");

        assert!(result.message.contains("1 conflicting file was left unchanged"));
        assert!(root.join("incoming/Alpha.mp3").is_file());
        assert_eq!(
            fs::read(root.join("Audio/A/Alpha.mp3")).expect("destination should remain"),
            vec![2_u8; 8]
        );
        assert!(root.join("Audio/B/Beta.flac").is_file());

        fs::remove_dir_all(root).expect("test folder should be removed");
    }

    #[test]
    fn flattens_files_and_removes_only_empty_folders_when_reviewed() {
        let root = create_test_folder();
        fs::create_dir_all(root.join("Audio/A"))
            .expect("audio fixture folder should be created");
        fs::create_dir_all(root.join("Video/B"))
            .expect("video fixture folder should be created");
        fs::create_dir_all(root.join("Already Empty"))
            .expect("empty fixture folder should be created");
        fs::create_dir_all(root.join(".git"))
            .expect("ignored fixture folder should be created");
        fs::write(root.join("Audio/A/Alpha.mp3"), [1_u8; 8])
            .expect("audio fixture should be written");
        fs::write(root.join("Video/B/Beta.mp4"), [2_u8; 8])
            .expect("video fixture should be written");
        let base = root.to_string_lossy().into_owned();
        let plan = OrganizationPlan {
            group_by: vec![OrganizationGrouping::Root],
            scope: OrganizationScope::AllFiles,
            subfolder_path: None,
            remove_empty_folders: true,
        };

        let preview = preview_organization_plan(base.clone(), plan.clone())
            .expect("flatten preview should succeed");
        assert_eq!(preview.planned_moves, 2);
        assert_eq!(preview.conflicts, 0);
        assert_eq!(preview.planned_folder_removals, 5);

        let result = execute_organization_plan(base, plan, preview.fingerprint)
            .expect("flatten plan should succeed");
        assert!(result.message.contains("Removed 5 empty folders"));
        assert!(root.join("Alpha.mp3").is_file());
        assert!(root.join("Beta.mp4").is_file());
        assert!(!root.join("Audio").exists());
        assert!(!root.join("Video").exists());
        assert!(!root.join("Already Empty").exists());
        assert!(root.join(".git").is_dir());

        fs::remove_dir_all(root).expect("test folder should be removed");
    }

    #[test]
    fn refuses_escape_root_deletion_and_overwrites() {
        let root = create_test_folder();
        fs::write(root.join("first.txt"), "first").expect("fixture should be written");
        fs::write(root.join("second.txt"), "second").expect("fixture should be written");
        let base = root.to_string_lossy().into_owned();

        let escape = execute_filesystem_operations(
            base.clone(),
            vec![FilesystemAction::Delete {
                path: "../outside.txt".to_string(),
            }],
            None,
        );
        let root_delete = execute_filesystem_operations(
            base.clone(),
            vec![FilesystemAction::Delete {
                path: ".".to_string(),
            }],
            None,
        );
        let overwrite = execute_filesystem_operations(
            base,
            vec![FilesystemAction::Copy {
                from: "first.txt".to_string(),
                to: "second.txt".to_string(),
            }],
            None,
        );

        assert!(escape.is_err());
        assert!(root_delete.is_err());
        assert!(overwrite.is_err());
        assert_eq!(fs::read_to_string(root.join("second.txt")).unwrap(), "second");
        fs::remove_dir_all(root).expect("test folder should be removed");
    }

    #[test]
    fn live_scan_keeps_metadata_and_reads_only_selected_safe_files() {
        let root = create_test_folder();
        fs::create_dir(root.join("src")).expect("source folder should be created");
        fs::create_dir(root.join("node_modules")).expect("ignored folder should be created");
        fs::write(root.join("src/main.rs"), "fn main() {}")
            .expect("source fixture should be written");
        fs::write(root.join("image.png"), [1_u8, 2, 3])
            .expect("binary fixture should be written");
        fs::write(root.join(".env"), "SECRET=not-for-model")
            .expect("secret fixture should be written");
        fs::write(root.join("node_modules/dependency.js"), "ignored")
            .expect("dependency fixture should be written");

        let scan = scan_project_folder(root.clone()).expect("live scan should succeed");
        assert!(scan.included_files.is_empty());
        assert_eq!(scan.total_characters, 0);
        assert!(scan
            .live_entries
            .iter()
            .any(|entry| entry.path == "src/main.rs" && entry.readable));
        assert!(scan
            .live_entries
            .iter()
            .any(|entry| entry.path == "image.png" && !entry.readable));
        assert!(!scan
            .live_entries
            .iter()
            .any(|entry| entry.path.contains(".env") || entry.path.contains("node_modules")));

        let base = root.to_string_lossy().into_owned();
        let selected = read_project_files(base.clone(), vec!["src/main.rs".to_string()])
            .expect("selected source should be read");
        assert_eq!(selected.len(), 1);
        assert!(selected[0].contents.contains("fn main"));
        assert!(read_project_files(base.clone(), vec![".env".to_string()]).is_err());
        assert!(read_project_files(base, vec!["../outside.txt".to_string()]).is_err());

        fs::remove_dir_all(root).expect("test folder should be removed");
    }

    // ─── New feature tests ────────────────────────────────────────────────────

    /// Simulate a realistic "Downloads/Projects" folder with 60+ mixed files,
    /// then verify organize, delete, write, content-search, undo, and
    /// reference-aware rename all work correctly.
    fn create_large_test_folder() -> PathBuf {
        let root = create_test_folder();

        // Source code
        fs::create_dir_all(root.join("src/components")).unwrap();
        fs::create_dir_all(root.join("src/services")).unwrap();
        fs::create_dir_all(root.join("src/utils")).unwrap();
        fs::write(root.join("src/main.ts"), "import { App } from './components/App';\nApp.run();").unwrap();
        fs::write(root.join("src/components/App.tsx"), "export function App() { return <div>Hello</div>; }").unwrap();
        fs::write(root.join("src/components/Button.tsx"), "export function Button({ label }: { label: string }) { return <button>{label}</button>; }").unwrap();
        fs::write(root.join("src/components/Modal.tsx"), "import { Button } from './Button';\nexport function Modal() { return <div><Button label='Close' /></div>; }").unwrap();
        fs::write(root.join("src/services/api.ts"), "export async function fetchData(url: string) { return fetch(url); }").unwrap();
        fs::write(root.join("src/services/auth.ts"), "export function getToken() { return localStorage.getItem('token'); }").unwrap();
        fs::write(root.join("src/utils/format.ts"), "export function formatDate(d: Date) { return d.toISOString(); }").unwrap();
        fs::write(root.join("src/utils/helpers.ts"), "export function clamp(n: number, min: number, max: number) { return Math.min(Math.max(n, min), max); }").unwrap();

        // Documents
        fs::create_dir_all(root.join("docs")).unwrap();
        fs::write(root.join("docs/README.md"), "# Project\nThis is the project readme.").unwrap();
        fs::write(root.join("docs/CHANGELOG.md"), "## v1.0\n- Initial release").unwrap();
        fs::write(root.join("docs/API.md"), "## API Reference\n### fetchData\nFetches remote data.").unwrap();
        fs::write(root.join("docs/design.md"), "## Design decisions\nUse TypeScript for type safety.").unwrap();

        // Config
        fs::write(root.join("package.json"), r#"{"name":"test","version":"1.0.0"}"#).unwrap();
        fs::write(root.join("tsconfig.json"), r#"{"compilerOptions":{"strict":true}}"#).unwrap();
        fs::write(root.join(".env.example"), "API_URL=https://example.com\nTOKEN=your-token").unwrap();
        fs::write(root.join("vite.config.ts"), "import { defineConfig } from 'vite';\nexport default defineConfig({});").unwrap();

        // Media files
        fs::create_dir_all(root.join("assets/images")).unwrap();
        fs::create_dir_all(root.join("assets/audio")).unwrap();
        for i in 1..=12 {
            fs::write(root.join(format!("assets/audio/track{i:02}.mp3")), [0_u8; 8]).unwrap();
        }
        for i in 1..=8 {
            fs::write(root.join(format!("assets/images/photo{i:02}.jpg")), [0_u8; 8]).unwrap();
        }
        fs::write(root.join("assets/images/logo.svg"), "<svg></svg>").unwrap();

        // Data files
        fs::create_dir_all(root.join("data")).unwrap();
        fs::write(root.join("data/users.csv"), "id,name,email\n1,Alice,alice@example.com\n2,Bob,bob@example.com").unwrap();
        fs::write(root.join("data/config.yaml"), "server:\n  host: localhost\n  port: 8080").unwrap();
        fs::write(root.join("data/schema.sql"), "CREATE TABLE users (id INT PRIMARY KEY, name TEXT);").unwrap();

        // Loose files at root
        for i in 1..=5 {
            fs::write(root.join(format!("note{i}.txt")), format!("Note number {i}. Contains searchable content.")).unwrap();
        }
        fs::write(root.join("build.sh"), "#!/bin/bash\nnpm run build").unwrap();
        fs::write(root.join("deploy.ps1"), "Write-Host 'Deploying...'\nnpm run deploy").unwrap();

        root
    }

    #[test]
    fn write_file_creates_new_and_updates_existing() {
        let root = create_test_folder();
        let base = root.to_string_lossy().into_owned();

        // Create a new file
        let result = write_project_file(
            base.clone(),
            "src/new-module.ts".to_string(),
            "export const answer = 42;".to_string(),
        ).expect("write should succeed");
        assert!(result.success);
        assert!(result.message.contains("Created"));
        assert_eq!(
            fs::read_to_string(root.join("src/new-module.ts")).unwrap(),
            "export const answer = 42;"
        );

        // Update an existing file
        let result2 = write_project_file(
            base.clone(),
            "src/new-module.ts".to_string(),
            "export const answer = 100;".to_string(),
        ).expect("update should succeed");
        assert!(result2.success);
        assert!(result2.message.contains("Updated"));
        assert_eq!(
            fs::read_to_string(root.join("src/new-module.ts")).unwrap(),
            "export const answer = 100;"
        );

        // Reject path traversal attempts
        assert!(write_project_file(base.clone(), "../escape.txt".to_string(), "bad".to_string()).is_err());
        assert!(write_project_file(base.clone(), ".env".to_string(), "bad".to_string()).is_err());

        // Reject oversized content
        let big = "x".repeat(MAX_WRITE_FILE_SIZE + 1);
        assert!(write_project_file(base, "big.txt".to_string(), big).is_err());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn content_search_finds_terms_across_files() {
        let root = create_large_test_folder();
        let base = root.to_string_lossy().into_owned();

        // Search for a unique term
        let results = search_project_file_contents(
            base.clone(),
            "fetchData".to_string(),
            None,
            None,
            None,
        ).expect("content search should succeed");
        assert!(results.total_files_searched >= 2, "fetchData appears in api.ts and API.md");
        assert!(results.results.iter().any(|r| r.path.contains("api.ts")));
        assert!(results.results.iter().any(|r| r.path.contains("API.md")));

        // Case-insensitive by default
        let results2 = search_project_file_contents(
            base.clone(),
            "fetchdata".to_string(),
            Some(false),
            None,
            None,
        ).expect("case-insensitive search should succeed");
        assert!(results2.total_files_searched >= 2);

        // Case-sensitive miss
        let results3 = search_project_file_contents(
            base.clone(),
            "fetchdata".to_string(),
            Some(true),
            None,
            None,
        ).expect("case-sensitive search should succeed");
        assert_eq!(results3.total_files_searched, 0, "lowercase version should not match with case-sensitive search");

        // Search for content in notes
        let results4 = search_project_file_contents(
            base.clone(),
            "searchable content".to_string(),
            None,
            None,
            None,
        ).expect("multi-word search should succeed");
        assert_eq!(results4.total_files_searched, 5, "all 5 notes contain 'searchable content'");

        // Empty query should fail
        assert!(search_project_file_contents(base, "".to_string(), None, None, None).is_err());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn undo_restores_deleted_files() {
        let root = create_test_folder();
        fs::write(root.join("important.txt"), "do not lose this").unwrap();
        fs::write(root.join("also-important.md"), "# Keep me").unwrap();
        fs::write(root.join("disposable.log"), "temp").unwrap();
        let base = root.to_string_lossy().into_owned();

        // Delete with backup
        let result = execute_filesystem_operations(
            base.clone(),
            vec![
                FilesystemAction::Delete { path: "important.txt".to_string() },
                FilesystemAction::Delete { path: "also-important.md".to_string() },
            ],
            Some(true),
        ).expect("delete with backup should succeed");
        assert!(result.success);
        let backup = result.backup_path.expect("backup path should be returned");
        assert!(!root.join("important.txt").exists());
        assert!(!root.join("also-important.md").exists());

        // Undo restores the files
        let undo_result = undo_filesystem_operation(base.clone(), backup)
            .expect("undo should succeed");
        assert!(undo_result.success);
        assert!(undo_result.message.contains("2"), "should report 2 restored files");
        assert_eq!(
            fs::read_to_string(root.join("important.txt")).unwrap(),
            "do not lose this"
        );
        assert_eq!(
            fs::read_to_string(root.join("also-important.md")).unwrap(),
            "# Keep me"
        );

        // Delete without backup returns no backup path
        let no_backup = execute_filesystem_operations(
            base,
            vec![FilesystemAction::Delete { path: "disposable.log".to_string() }],
            Some(false),
        ).expect("delete without backup should succeed");
        assert!(no_backup.backup_path.is_none());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rename_with_references_updates_imports() {
        let root = create_test_folder();
        fs::create_dir(root.join("src")).unwrap();

        // Original file
        fs::write(root.join("src/Button.tsx"), "export function Button() {}").unwrap();

        // Files that reference it
        fs::write(
            root.join("src/App.tsx"),
            "import { Button } from './Button';\nimport { Modal } from './Modal';\nexport function App() { return <Button />; }",
        ).unwrap();
        fs::write(
            root.join("src/index.ts"),
            "import { Button } from './Button';\nexport { Button };",
        ).unwrap();
        // File that should NOT be changed (different name)
        fs::write(
            root.join("src/other.ts"),
            "import { Badge } from './Badge';\nexport default Badge;",
        ).unwrap();

        let base = root.to_string_lossy().into_owned();
        let result = rename_with_references(
            base,
            "src/Button.tsx".to_string(),
            "PrimaryButton.tsx".to_string(),
        ).expect("rename with references should succeed");

        assert!(result.success);
        assert!(root.join("src/PrimaryButton.tsx").exists());
        assert!(!root.join("src/Button.tsx").exists());

        // References should be updated
        let app_content = fs::read_to_string(root.join("src/App.tsx")).unwrap();
        assert!(app_content.contains("PrimaryButton"), "App.tsx should reference PrimaryButton");
        assert!(!app_content.contains("'./Button'"), "App.tsx should no longer reference './Button'");

        let index_content = fs::read_to_string(root.join("src/index.ts")).unwrap();
        assert!(index_content.contains("PrimaryButton"));

        // Unrelated file must not change
        let other_content = fs::read_to_string(root.join("src/other.ts")).unwrap();
        assert_eq!(other_content, "import { Badge } from './Badge';\nexport default Badge;");

        // Message should report updates
        assert!(result.message.contains("renamed") || result.message.contains("Renamed"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn subfolder_organization_scopes_to_subdirectory() {
        let root = create_test_folder();
        // Files in a subfolder
        fs::create_dir_all(root.join("downloads/mixed")).unwrap();
        fs::write(root.join("downloads/Alpha.mp3"), [0_u8; 8]).unwrap();
        fs::write(root.join("downloads/Beta.flac"), [0_u8; 8]).unwrap();
        fs::write(root.join("downloads/Gamma.pdf"), [0_u8; 8]).unwrap();
        fs::write(root.join("downloads/mixed/Delta.mp3"), [0_u8; 8]).unwrap();
        // Files at root that should NOT be moved
        fs::write(root.join("root-level.txt"), "stay here").unwrap();

        let base = root.to_string_lossy().into_owned();
        let plan = OrganizationPlan {
            group_by: vec![OrganizationGrouping::FileType],
            scope: OrganizationScope::Subfolder,
            subfolder_path: Some("downloads".to_string()),
            remove_empty_folders: false,
        };

        let preview = preview_organization_plan(base.clone(), plan.clone())
            .expect("subfolder preview should succeed");
        // Should only touch the 4 files inside downloads/
        assert_eq!(preview.total_files, 4, "only files inside downloads/ should be counted");
        // Alpha, Beta, Delta -> Audio; Gamma -> Documents
        assert!(preview.sample_actions.iter().any(|a| matches!(
            a,
            FilesystemAction::Move { from, to }
                if from.starts_with("downloads/") && to.starts_with("downloads/Audio/")
        )));
        assert!(preview.sample_actions.iter().any(|a| matches!(
            a,
            FilesystemAction::Move { from, to }
                if from.starts_with("downloads/") && to.starts_with("downloads/Documents/")
        )));

        execute_organization_plan(base, plan, preview.fingerprint)
            .expect("subfolder organization should succeed");

        // Files should be in downloads/ subfolders
        assert!(root.join("downloads/Audio/Alpha.mp3").is_file());
        assert!(root.join("downloads/Audio/Beta.flac").is_file());
        assert!(root.join("downloads/Audio/Delta.mp3").is_file());
        assert!(root.join("downloads/Documents/Gamma.pdf").is_file());

        // Root-level file must be untouched
        assert_eq!(
            fs::read_to_string(root.join("root-level.txt")).unwrap(),
            "stay here"
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn large_folder_organize_delete_and_verify() {
        let root = create_large_test_folder();
        let base = root.to_string_lossy().into_owned();

        // ── Step 1: organize assets/audio by file type ───────────────────────
        let plan = OrganizationPlan {
            group_by: vec![OrganizationGrouping::FileType],
            scope: OrganizationScope::Subfolder,
            subfolder_path: Some("assets/audio".to_string()),
            remove_empty_folders: false,
        };
        let preview = preview_organization_plan(base.clone(), plan.clone())
            .expect("audio subfolder preview should succeed");
        assert_eq!(preview.total_files, 12);
        // All 12 mp3 files should be planned for move into Audio/
        assert_eq!(preview.planned_moves, 12);
        execute_organization_plan(base.clone(), plan, preview.fingerprint)
            .expect("audio organization should succeed");
        assert!(root.join("assets/audio/Audio/track01.mp3").is_file());
        assert!(root.join("assets/audio/Audio/track12.mp3").is_file());

        // ── Step 2: delete temp files with backup ────────────────────────────
        let delete_result = execute_filesystem_operations(
            base.clone(),
            vec![
                FilesystemAction::Delete { path: "note1.txt".to_string() },
                FilesystemAction::Delete { path: "note2.txt".to_string() },
                FilesystemAction::Delete { path: "note3.txt".to_string() },
            ],
            Some(true),
        ).expect("delete with backup should succeed");
        assert!(delete_result.success);
        let backup_path = delete_result.backup_path.expect("backup path must be present");
        assert!(!root.join("note1.txt").exists());
        assert!(!root.join("note2.txt").exists());

        // ── Step 3: undo the deletion ─────────────────────────────────────────
        let undo = undo_filesystem_operation(base.clone(), backup_path)
            .expect("undo should succeed");
        assert!(undo.success);
        assert!(root.join("note1.txt").exists(), "note1.txt should be restored");
        assert!(root.join("note2.txt").exists(), "note2.txt should be restored");
        assert!(root.join("note3.txt").exists(), "note3.txt should be restored");

        // ── Step 4: content search across the large tree ─────────────────────
        let search = search_project_file_contents(
            base.clone(),
            "localhost".to_string(),
            None,
            None,
            None,
        ).expect("content search should succeed");
        assert!(search.total_files_searched >= 1, "config.yaml contains 'localhost'");
        assert!(search.results.iter().any(|r| r.path.contains("config.yaml")));

        // ── Step 5: write a new config file and verify ───────────────────────
        let write_result = write_project_file(
            base.clone(),
            "data/new-config.json".to_string(),
            r#"{"environment":"test","debug":true}"#.to_string(),
        ).expect("write should succeed");
        assert!(write_result.success);
        assert!(root.join("data/new-config.json").is_file());

        // ── Step 6: rename with references ───────────────────────────────────
        // api.ts is referenced by its stem, rename it and verify references update
        let rename_result = rename_with_references(
            base.clone(),
            "src/services/api.ts".to_string(),
            "client.ts".to_string(),
        ).expect("rename with references should succeed");
        assert!(rename_result.success);
        assert!(root.join("src/services/client.ts").is_file());
        assert!(!root.join("src/services/api.ts").exists());

        // ── Step 7: delete without backup (permanent) ─────────────────────────
        let perm_delete = execute_filesystem_operations(
            base.clone(),
            vec![FilesystemAction::Delete { path: "build.sh".to_string() }],
            Some(false),
        ).expect("permanent delete should succeed");
        assert!(perm_delete.success);
        assert!(perm_delete.backup_path.is_none());
        assert!(!root.join("build.sh").exists());

        fs::remove_dir_all(root).unwrap();
    }
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
