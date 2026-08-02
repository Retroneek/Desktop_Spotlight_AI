import { invoke } from "@tauri-apps/api/core";
import type {
  ProjectFolderFile,
  ProjectFolderScan,
} from "./contextBuilder";

export async function readLiveFolderFiles(
  basePath: string,
  paths: string[],
): Promise<ProjectFolderFile[]> {
  if (!paths.length) return [];

  return invoke("read_project_files", {
    basePath,
    paths,
  });
}

export type WorkspaceEntry = {
  path: string;
  name: string;
  kind: "file" | "folder";
  size: number;
  modifiedAt?: number;
  readable: boolean;
};

export type WorkspaceEntryPage = {
  entries: WorkspaceEntry[];
  nextCursor?: number;
  totalMatches: number;
};

export type WorkspaceInspection = {
  path: string;
  kind: "file" | "folder";
  size: number;
  modifiedAt?: number;
  extension: string;
  readableAsText: boolean;
  audioMetadata?: {
    title?: string;
    artist?: string;
    album?: string;
    genre?: string;
    track?: number;
    trackTotal?: number;
    disk?: number;
    diskTotal?: number;
    durationSeconds: number;
    audioBitrateKbps?: number;
    sampleRateHz?: number;
    channels?: number;
  };
};

export type WorkspaceFileChunk = {
  path: string;
  offset: number;
  nextOffset?: number;
  totalBytes: number;
  content: string;
};

export function browseLiveFolder(
  basePath: string,
  relativePath = "",
  cursor = 0,
  limit = 100,
) {
  return invoke<WorkspaceEntryPage>("browse_project_folder", {
    basePath,
    relativePath,
    cursor,
    limit,
  });
}

export function searchLiveFolder(
  basePath: string,
  query: string,
  cursor = 0,
  limit = 100,
) {
  return invoke<WorkspaceEntryPage>("search_project_folder", {
    basePath,
    query,
    cursor,
    limit,
  });
}

export function inspectLiveFolderEntries(basePath: string, paths: string[]) {
  return invoke<WorkspaceInspection[]>("inspect_project_entries", {
    basePath,
    paths,
  });
}

export function readLiveFolderFileChunk(
  basePath: string,
  path: string,
  offset = 0,
  maxBytes = 16_000,
) {
  return invoke<WorkspaceFileChunk>("read_project_file_chunk", {
    basePath,
    path,
    offset,
    maxBytes,
  });
}

export function refreshLiveFolder(basePath: string) {
  return invoke<ProjectFolderScan>("refresh_project_folder", {
    basePath,
  });
}
