import {
  type SkippedFolderFile,
  truncateContext,
} from "../services/contextBuilder";
import { normalizeOllamaBaseUrl } from "../services/endpoint";
import {
  hardwareProfiles,
  storageKeys,
  type HardwareProfileId,
} from "./config";
import type { AttachedFile, ChatSession, Theme } from "./types";

export function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getTimestampFromId(id: string) {
  const match = id.match(/-(\d{10,})/);
  return match ? Number(match[1]) : undefined;
}

export function formatLocalTime(timestamp?: number) {
  if (!timestamp) return "";

  return new Date(timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function getHistoryGroupLabel(timestamp: number) {
  const date = new Date(timestamp);
  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const startOfTarget = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const dayDifference = Math.round(
    (startOfToday.getTime() - startOfTarget.getTime()) /
      (1000 * 60 * 60 * 24),
  );

  if (dayDifference === 0) return "Today";
  if (dayDifference === 1) return "Yesterday";

  if (dayDifference > 1 && dayDifference < 7) {
    return date.toLocaleDateString(undefined, { weekday: "long" });
  }

  if (date.getFullYear() === today.getFullYear()) {
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function createSession(title = "New chat"): ChatSession {
  const now = Date.now();

  return {
    id: createId("chat"),
    title,
    turns: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createPersistableSessions(sessions: ChatSession[]) {
  return sessions.map((session) => ({
    ...session,
    turns: session.turns.map((turn) => ({
      ...turn,
      files: turn.files?.map(normalizePersistedAttachment),
    })),
  }));
}

function normalizePersistedAttachment(file: AttachedFile): AttachedFile {
  return file.kind === "folder"
    ? {
        ...file,
        preview: "",
        supported: false,
        sourcePath: undefined,
        liveEntries: undefined,
        skippedFiles: [],
      }
    : {
        ...file,
        preview: truncateContext(file.preview, 2_000),
      };
}

function getInitialSessions(): ChatSession[] {
  try {
    const stored = localStorage.getItem(storageKeys.sessions);
    if (!stored) return [createSession()];

    const parsed = JSON.parse(stored) as ChatSession[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [createSession()];
    }

    return parsed.map((session) => {
      const createdAt =
        typeof session.createdAt === "number" ? session.createdAt : Date.now();

      return {
        ...session,
        title: typeof session.title === "string" ? session.title : "New chat",
        turns: Array.isArray(session.turns)
          ? session.turns.map((turn) => ({
              ...turn,
              createdAt:
                typeof turn.createdAt === "number"
                  ? turn.createdAt
                  : getTimestampFromId(turn.id) ?? createdAt,
            }))
          : [],
        createdAt,
        updatedAt:
          typeof session.updatedAt === "number"
            ? session.updatedAt
            : Date.now(),
      };
    });
  } catch {
    return [createSession()];
  }
}

export function getInitialAttachedFiles(): AttachedFile[] {
  try {
    const stored = localStorage.getItem(storageKeys.attachments);
    if (!stored) return [];

    const parsed = JSON.parse(stored) as AttachedFile[];
    if (!Array.isArray(parsed)) return [];

    return parsed.map(normalizeStoredAttachment);
  } catch {
    return [];
  }
}

function normalizeStoredAttachment(file: AttachedFile): AttachedFile {
  const kind = file.kind === "folder" ? "folder" : "file";
  const preview = typeof file.preview === "string" ? file.preview : "";

  return {
    id: typeof file.id === "string" ? file.id : createId("file"),
    kind,
    name: typeof file.name === "string" ? file.name : "Untitled file",
    typeLabel: typeof file.typeLabel === "string" ? file.typeLabel : "file",
    sizeLabel: typeof file.sizeLabel === "string" ? file.sizeLabel : "0 B",
    preview:
      kind === "folder" ? truncateContext(preview, 450_000) : preview,
    supported: Boolean(file.supported),
    sourcePath:
      kind === "folder" &&
      typeof file.sourcePath === "string" &&
      file.sourcePath.trim()
        ? file.sourcePath
        : undefined,
    liveEntries:
      kind === "folder" && Array.isArray(file.liveEntries)
        ? file.liveEntries
            .filter(
              (entry) =>
                entry &&
                typeof entry === "object" &&
                typeof entry.path === "string" &&
                typeof entry.size === "number" &&
                typeof entry.readable === "boolean",
            )
            .map((entry) => ({
              path: entry.path,
              size: entry.size,
              modifiedAt:
                typeof entry.modifiedAt === "number"
                  ? entry.modifiedAt
                  : undefined,
              readable: entry.readable,
            }))
            .slice(0, 2_000)
        : undefined,
    folderStats:
      file.folderStats &&
      typeof file.folderStats === "object" &&
      typeof file.folderStats.rootName === "string"
        ? file.folderStats
        : undefined,
    skippedFiles: Array.isArray(file.skippedFiles)
      ? file.skippedFiles.filter(
          (item): item is SkippedFolderFile =>
            item &&
            typeof item === "object" &&
            typeof item.path === "string" &&
            typeof item.reason === "string",
        ).slice(0, 200)
      : undefined,
  };
}

export function getInitialAppState() {
  const sessions = getInitialSessions();

  try {
    const storedActiveId = localStorage.getItem(storageKeys.activeSession);
    const activeSessionId =
      storedActiveId && sessions.some((session) => session.id === storedActiveId)
        ? storedActiveId
        : sessions[0].id;

    return { sessions, activeSessionId };
  } catch {
    return { sessions, activeSessionId: sessions[0].id };
  }
}

export function getInitialTheme(): Theme {
  try {
    return localStorage.getItem(storageKeys.theme) === "light"
      ? "light"
      : "dark";
  } catch {
    return "dark";
  }
}

export function getInitialSidebarCollapsed() {
  try {
    return localStorage.getItem(storageKeys.sidebarCollapsed) === "true";
  } catch {
    return false;
  }
}

export function getInitialSelectedModel() {
  try {
    return localStorage.getItem(storageKeys.selectedModel) ?? "";
  } catch {
    return "";
  }
}

export function getInitialHardwareProfile(): HardwareProfileId {
  try {
    const stored = localStorage.getItem(storageKeys.hardwareProfile);
    if (stored && hardwareProfiles.some((profile) => profile.id === stored)) {
      return stored as HardwareProfileId;
    }
  } catch {
    // Fall through to the balanced profile when storage is unavailable.
  }

  return "balanced";
}

export function getInitialOllamaEndpoint() {
  try {
    return normalizeOllamaBaseUrl(
      localStorage.getItem(storageKeys.ollamaEndpoint) ??
        "http://127.0.0.1:11434",
    );
  } catch {
    return "http://127.0.0.1:11434";
  }
}
