import {
  type DragEvent,
  type KeyboardEvent,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  buildBackgroundContext,
  buildCompactPrompt,
  buildPrompt,
  createFolderAttachmentFromScan,
  hydrateLiveFolderAttachment,
  liveFolderQueryNeedsContents,
  selectLiveFolderPaths,
  type ProjectFolderScan,
  summarizeBrowserFolder,
  truncateContext,
} from "./services/contextBuilder";
import {
  getModelList,
  getModelName,
  getModelPreferenceScore,
} from "./services/models";
import { useOllama } from "./services/ollama";
import { buildProjectRetrievalQuery, quickRouteProject } from "./services/chatProtocol";
import { normalizeOllamaBaseUrl } from "./services/endpoint";
import {
  browseLiveFolder,
  inspectLiveFolderEntries,
  readLiveFolderFileChunk,
  readLiveFolderFiles,
  refreshLiveFolder,
  searchLiveFolder,
  searchLiveFolderContents,
  writeWorkspaceFile,
} from "./services/liveFolder";
import {
  composerLayout,
  folderInputAttributes,
  maxMessageHeight,
  runtimeProfiles,
  storageKeys,
  type HardwareProfileId,
} from "./app/config";
import {
  buildAttachmentAwarePrompt,
  buildGenerationOptions,
  buildMessages,
} from "./app/chat";
import {
  hasDraggedFiles,
  isTauriRuntime,
  summarizeFile,
} from "./app/fileAttachments";
import {
  createId,
  createPersistableSessions,
  createSession,
  getHistoryGroupLabel,
  getInitialAppState,
  getInitialAttachedFiles,
  getInitialHardwareProfile,
  getInitialOllamaEndpoint,
  getInitialSelectedModel,
  getInitialSidebarCollapsed,
  getInitialTheme,
} from "./app/sessionStorage";
import type {
  AttachedFile,
  ChatSession,
  ChatTurn,
  HistoryMenuState,
  OllamaMessage,
  RegenerateTarget,
  Theme,
} from "./app/types";
import { EditIcon } from "./components/icons";
import { ConversationLog } from "./components/ConversationLog";
import { FilePreview, type PreviewMode } from "./components/FilePreview";
import { MessageComposer } from "./components/MessageComposer";
import { ModelSelector } from "./components/ModelSelector";
import { SettingsPanel } from "./components/SettingsPanel";
import { Sidebar } from "./components/Sidebar";
import "./App.css";

function workspaceToolString(
  argumentsValue: Record<string, unknown>,
  key: string,
  fallback = "",
) {
  const value = argumentsValue[key];
  return typeof value === "string" ? value.trim() : fallback;
}

function workspaceToolInteger(
  argumentsValue: Record<string, unknown>,
  key: string,
  fallback: number,
  maximum: number,
) {
  const value = argumentsValue[key];
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(maximum, Math.floor(value)))
    : fallback;
}

function workspaceToolPaths(argumentsValue: Record<string, unknown>, maximum: number) {
  const value = argumentsValue.paths;
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (path): path is string =>
          typeof path === "string" && Boolean(path.trim()),
      ),
    ),
  ].slice(0, maximum);
}

function App() {
  const initialStateRef = useRef(getInitialAppState());
  const initialAttachedFilesRef = useRef(getInitialAttachedFiles());
  const initialOllamaEndpoint = useRef(getInitialOllamaEndpoint());
  const [ollamaEndpoint, setOllamaEndpoint] = useState(
    initialOllamaEndpoint.current,
  );
  const [endpointDraft, setEndpointDraft] = useState(
    initialOllamaEndpoint.current,
  );

  const {
    models,
    streamChat,
    isGenerating,
    error,
    refreshModels,
    cancelChat,
    shouldReadProject,
    selectProjectFiles,
    runLiveWorkspaceAgent,
    warmModel,
  } = useOllama(ollamaEndpoint);

  const [hardwareProfile, setHardwareProfile] = useState<HardwareProfileId>(
    getInitialHardwareProfile,
  );
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    getInitialSidebarCollapsed,
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedModelName, setSelectedModelName] = useState(
    getInitialSelectedModel,
  );
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);

  const [sessions, setSessions] = useState<ChatSession[]>(
    initialStateRef.current.sessions,
  );

  const [activeSessionId, setActiveSessionId] = useState(
    initialStateRef.current.activeSessionId,
  );

  const [projectContext, setProjectContext] = useState<AttachedFile | null>(
    () =>
      initialAttachedFilesRef.current.find((file) => file.kind === "folder") ??
      null,
  );
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>(() =>
    initialAttachedFilesRef.current.filter((file) => file.kind !== "folder"),
  );

  const [message, setMessage] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [workspaceActivity, setWorkspaceActivity] = useState("");
  const [isComposerExpanded, setIsComposerExpanded] = useState(false);
  const [selectedPreviewFileId, setSelectedPreviewFileId] = useState<
    string | null
  >(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewMode, setPreviewMode] =
    useState<PreviewMode>("extracted");

  const [historyMenu, setHistoryMenu] =
    useState<HistoryMenuState | null>(null);

  const [editingSessionId, setEditingSessionId] =
    useState<string | null>(null);

  const [draftTitle, setDraftTitle] = useState("");
  const [streamingTurnId, setStreamingTurnId] =
    useState<string | null>(null);

  const messageRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const responseLogRef = useRef<HTMLDivElement>(null);
  const streamingTextElementRef = useRef<HTMLParagraphElement>(null);

  const dragDepthRef = useRef(0);
  const streamedTextRef = useRef("");
  const streamFrameRef = useRef<number | null>(null);
  const stickToBottomRef = useRef(true);
  const warmedModelRef = useRef("");

  const availableModelNames = useMemo(() => {
    return [...new Set(
      getModelList(models)
        .map(getModelName)
        .filter((name): name is string => typeof name === "string")
        .map((name) => name.trim())
        .filter(Boolean),
    )]
      .sort(
        (left, right) =>
          getModelPreferenceScore(right) - getModelPreferenceScore(left) ||
          left.localeCompare(right),
      );
  }, [models]);

  const activeModelName =
    selectedModelName &&
    availableModelNames.includes(selectedModelName)
      ? selectedModelName
      : availableModelNames[0] ?? "";

  const runtimeProfile = runtimeProfiles[hardwareProfile];

  const sortedSessions = useMemo(() => {
    return [...sessions].sort((left, right) => right.updatedAt - left.updatedAt);
  }, [sessions]);

  const historySections = useMemo(() => {
    const sections: Array<{
      label: string;
      sessions: ChatSession[];
    }> = [];

    for (const session of sortedSessions) {
      const label = getHistoryGroupLabel(session.updatedAt);
      const currentSection = sections[sections.length - 1];

      if (!currentSection || currentSection.label !== label) {
        sections.push({ label, sessions: [session] });
        continue;
      }

      currentSection.sessions.push(session);
    }

    return sections;
  }, [sortedSessions]);

  const hasSavedChats = useMemo(() => {
    return sessions.some((session) => session.turns.length > 0);
  }, [sessions]);

  const collapsedPreviewSessions = useMemo(() => {
    return sortedSessions
      .filter((session) => session.turns.length > 0)
      .slice(0, 3);
  }, [sortedSessions]);

  const [isCanceling, setIsCanceling] = useState(false);

  const activeSession = useMemo(() => {
    return (
      sessions.find((session) => session.id === activeSessionId) ??
      sessions[0]
    );
  }, [activeSessionId, sessions])!;

  const hasDraftMessage =
    message.trim().length > 0;
  const hasTemporaryAttachment = attachedFiles.some(
    (file) => file.kind === "file",
  );
  const hasPrompt =
    hasDraftMessage || hasTemporaryAttachment;

  const contextAttachments = useMemo(
    () => (projectContext ? [projectContext, ...attachedFiles] : attachedFiles),
    [attachedFiles, projectContext],
  );
  const deferredMessage = useDeferredValue(message);

  const selectedPreviewFile = useMemo(() => {
    if (!contextAttachments.length) {
      return null;
    }

    return (
      contextAttachments.find(
        (file) => file.id === selectedPreviewFileId,
      ) ?? contextAttachments[0]
    );
  }, [contextAttachments, selectedPreviewFileId]);

  const pendingPromptPreview = useMemo(() => {
    if (
      !selectedPreviewFile ||
      !isPreviewOpen ||
      previewMode !== "sent"
    ) {
      return "";
    }

    const visibleContent =
      deferredMessage.trim() ||
      `Attached ${contextAttachments.length} file(s).`;
    const folderFiles = contextAttachments.filter(
      (file) => file.kind === "folder",
    );
    const directFiles = contextAttachments.filter(
      (file) => file.kind !== "folder",
    );

    return buildAttachmentAwarePrompt(
      visibleContent,
      directFiles,
      folderFiles,
    );
  }, [
    contextAttachments,
    deferredMessage,
    isPreviewOpen,
    previewMode,
    selectedPreviewFile,
  ]);

  const activePreviewText = selectedPreviewFile
    ? previewMode === "sent"
      ? pendingPromptPreview
      : selectedPreviewFile.preview
    : "";

  const activeSessionHasTurns =
    activeSession.turns.length > 0;

  const regenerateTarget = useMemo<RegenerateTarget | null>(() => {
    for (let index = activeSession.turns.length - 1; index > 0; index -= 1) {
      const assistantTurn = activeSession.turns[index];
      const userTurn = activeSession.turns[index - 1];

      if (
        assistantTurn.role === "assistant" &&
        userTurn.role === "user"
      ) {
        return {
          userTurn,
          assistantTurn,
          historyBeforeUserTurn: activeSession.turns.slice(0, index - 1),
        };
      }
    }

    return null;
  }, [activeSession.turns]);

  const emptyStateContent = useMemo(() => {
    if (projectContext) {
      return {
        title: "Project attached.",
        description:
          "Ask a question about the folder.",
      };
    }

    if (attachedFiles.length > 0) {
      return {
        title: "Files attached.",
        description:
          "Ask a question or send when you are ready.",
      };
    }

    if (hasDraftMessage) {
      return {
        title: "Draft in progress.",
        description:
          "Keep writing, attach a file, or send.",
      };
    }

    if (hasSavedChats && activeSessionHasTurns) {
      return {
        title: "Continue.",
        description:
          "Pick up where you left off or start something new.",
      };
    }

    return {
      title: "Ready.",
      description:
        "Drop a file or ask a question.",
    };
  }, [
    activeSessionHasTurns,
    attachedFiles.length,
    hasDraftMessage,
    hasSavedChats,
    projectContext,
  ]);

  const canSend =
    !isGenerating &&
    Boolean(activeModelName) &&
    hasPrompt;

  useEffect(() => {
    const saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(
          storageKeys.sessions,
          JSON.stringify(createPersistableSessions(sessions)),
        );
      } catch {
        // A conversation remains usable in memory if browser storage is full.
      }
    }, 250);

    return () => {
      window.clearTimeout(saveTimer);
    };
  }, [sessions]);

  useEffect(() => {
    const saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(
          storageKeys.attachments,
          JSON.stringify(contextAttachments),
        );
      } catch {
        // Attachments remain usable in memory if browser storage is full.
      }
    }, 250);

    return () => {
      window.clearTimeout(saveTimer);
    };
  }, [contextAttachments]);

  useEffect(() => {
    if (!contextAttachments.length) {
      if (selectedPreviewFileId !== null) {
        setSelectedPreviewFileId(null);
      }

      if (isPreviewOpen) {
        setIsPreviewOpen(false);
      }

      return;
    }

    if (
      !selectedPreviewFileId ||
      !contextAttachments.some(
        (file) => file.id === selectedPreviewFileId,
      )
    ) {
      setSelectedPreviewFileId(contextAttachments[0].id);
    }
  }, [contextAttachments, isPreviewOpen, selectedPreviewFileId]);

  useEffect(() => {
    if (projectContext?.sourcePath && !projectContext.liveEntries) {
      void rescanLiveFolder(projectContext);
    }
  }, [projectContext?.id, projectContext?.sourcePath]);

  useEffect(() => {
    localStorage.setItem(storageKeys.activeSession, activeSessionId);
  }, [activeSessionId]);

  useEffect(() => {
    localStorage.setItem(storageKeys.theme, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(
      storageKeys.hardwareProfile,
      hardwareProfile,
    );
  }, [hardwareProfile]);

  useEffect(() => {
    localStorage.setItem(
      storageKeys.sidebarCollapsed,
      String(isSidebarCollapsed),
    );
  }, [isSidebarCollapsed]);

  useEffect(() => {
    if (!availableModelNames.length) {
      if (selectedModelName) {
        setSelectedModelName("");
      }

      return;
    }

    if (!selectedModelName) {
      setSelectedModelName(availableModelNames[0]);
      return;
    }

    if (!availableModelNames.includes(selectedModelName)) {
      setSelectedModelName(availableModelNames[0]);
    }
  }, [availableModelNames, selectedModelName]);

  useEffect(() => {
    localStorage.setItem(storageKeys.selectedModel, activeModelName);
  }, [activeModelName]);

  useEffect(() => {
    if (!activeModelName || isGenerating) {
      return;
    }

    const warmKey = `${ollamaEndpoint}|${activeModelName}`;

    if (warmedModelRef.current === warmKey) {
      return;
    }

    let didCancel = false;

    const warmTimer = window.setTimeout(() => {
      void warmModel(activeModelName).then((didWarm) => {
        if (didWarm && !didCancel) {
          warmedModelRef.current = warmKey;
        }
      });
    }, 700);

    return () => {
      didCancel = true;
      window.clearTimeout(warmTimer);
    };
  }, [activeModelName, isGenerating, ollamaEndpoint, warmModel]);

  useEffect(() => {
    localStorage.setItem(
      storageKeys.ollamaEndpoint,
      ollamaEndpoint,
    );
  }, [ollamaEndpoint]);

  useEffect(() => {
    if (
      !sessions.some(
        (session) => session.id === activeSessionId,
      ) &&
      sessions[0]
    ) {
      setActiveSessionId(sessions[0].id);
    }
  }, [activeSessionId, sessions]);

  useEffect(() => {
    function closeHistoryMenu() {
      setHistoryMenu(null);
      setIsModelMenuOpen(false);
    }

    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;

      setHistoryMenu(null);
      setIsModelMenuOpen(false);
      setEditingSessionId(null);
      setIsSettingsOpen(false);
    }

    window.addEventListener("pointerdown", closeHistoryMenu);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener(
        "pointerdown",
        closeHistoryMenu,
      );

      window.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (streamFrameRef.current !== null) {
        window.cancelAnimationFrame(streamFrameRef.current);
      }
    };
  }, []);

  useLayoutEffect(() => {
    const textarea = messageRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";

    const nextHeight = Math.min(
      textarea.scrollHeight,
      maxMessageHeight,
    );

    const isExpanded =
      nextHeight >
      composerLayout.lineHeight + composerLayout.verticalPadding + 12;

    textarea.style.height = `${nextHeight}px`;

    textarea.style.overflowY =
      textarea.scrollHeight > maxMessageHeight
        ? "auto"
        : "hidden";

    setIsComposerExpanded((current) =>
      current === isExpanded ? current : isExpanded,
    );
  }, [message]);

  useLayoutEffect(() => {
    const responseLog = responseLogRef.current;
    if (!responseLog) return;

    stickToBottomRef.current = true;
    responseLog.scrollTop = responseLog.scrollHeight;
  }, [activeSessionId, activeSession.turns.length]);

  function updateTurnContent(
    sessionId: string,
    turnId: string,
    content: string,
  ) {
    setSessions((current) =>
      current.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        return {
          ...session,
          updatedAt: Date.now(),
          turns: session.turns.map((turn) =>
            turn.id === turnId
              ? {
                  ...turn,
                  content,
                }
              : turn,
          ),
        };
      }),
    );
  }

  function removeTurn(sessionId: string, turnId: string) {
    setSessions((current) =>
      current.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        return {
          ...session,
          updatedAt: Date.now(),
          turns: session.turns.filter((turn) => turn.id !== turnId),
        };
      }),
    );
  }

  function queueStreamPaint() {
    if (streamFrameRef.current !== null) {
      return;
    }

    streamFrameRef.current = window.requestAnimationFrame(() => {
      const textElement = streamingTextElementRef.current;
      const responseLog = responseLogRef.current;

      if (textElement) {
        textElement.textContent = streamedTextRef.current;
      }

      if (responseLog && stickToBottomRef.current) {
        responseLog.scrollTop = responseLog.scrollHeight;
      }

      streamFrameRef.current = null;
    });
  }

  async function addFiles(files: FileList | File[]) {
    const fileArray = Array.from(files);
    if (!fileArray.length) return;

    const nextFiles = await Promise.all(
      fileArray.map((file) =>
        summarizeFile(file, runtimeProfile.previewCharacters),
      ),
    );

    setAttachedFiles((current) => {
      const existingIds = new Set(
        current.map((file) => file.id),
      );

      return [
        ...current,
        ...nextFiles.filter(
          (file) => !existingIds.has(file.id),
        ),
      ];
    });
  }

  function attachFolder(folderAttachment: AttachedFile) {
    setProjectContext(folderAttachment);
    setSelectedPreviewFileId(folderAttachment.id);
    setIsPreviewOpen(true);
    setPreviewMode("extracted");
  }

  async function addBrowserFolder(files: FileList | File[]) {
    const fileArray = Array.from(files);
    if (!fileArray.length) return;

    attachFolder(await summarizeBrowserFolder(fileArray));
  }

  function createNewChat() {
    const nextSession = createSession();

    setSessions((current) => [
      nextSession,
      ...current,
    ]);

    setActiveSessionId(nextSession.id);
    setProjectContext(null);
    setAttachedFiles([]);
    setMessage("");
    setHistoryMenu(null);
    setEditingSessionId(null);
  }

  function selectSession(sessionId: string) {
    setActiveSessionId(sessionId);
    setProjectContext(null);
    setAttachedFiles([]);
    setMessage("");
    setHistoryMenu(null);
    setEditingSessionId(null);
  }

  function startRename(sessionId: string) {
    const session = sessions.find(
      (item) => item.id === sessionId,
    );

    if (!session) return;

    setDraftTitle(session.title);
    setEditingSessionId(sessionId);
    setHistoryMenu(null);
  }

  function commitRename() {
    const nextTitle = draftTitle.trim();

    if (!editingSessionId || !nextTitle) {
      setEditingSessionId(null);
      return;
    }

    setSessions((current) =>
      current.map((session) =>
        session.id === editingSessionId
          ? {
              ...session,
              title: nextTitle,
              updatedAt: Date.now(),
            }
          : session,
      ),
    );

    setEditingSessionId(null);
  }

  function duplicateSession(sessionId: string) {
    const session = sessions.find(
      (item) => item.id === sessionId,
    );

    if (!session) return;

    const now = Date.now();

    const duplicate: ChatSession = {
      ...session,
      id: createId("chat"),
      title: `${session.title} copy`,
      turns: session.turns.map((turn) => ({
        ...turn,
        id: createId(turn.role),
        files: turn.files?.map((file) => ({
          ...file,
        })),
      })),
      createdAt: now,
      updatedAt: now,
    };

    setSessions((current) => [
      duplicate,
      ...current,
    ]);

    setActiveSessionId(duplicate.id);
    setProjectContext(null);
    setAttachedFiles([]);
    setMessage("");
    setHistoryMenu(null);
  }

  function deleteSession(sessionId: string) {
    const remainingSessions = sessions.filter(
      (session) => session.id !== sessionId,
    );

    const nextSessions = remainingSessions.length
      ? remainingSessions
      : [createSession()];

    setSessions(nextSessions);

    setActiveSessionId((currentId) => {
      const currentStillExists = nextSessions.some(
        (session) => session.id === currentId,
      );

      return currentStillExists
        ? currentId
        : nextSessions[0].id;
    });

    setProjectContext(null);
    setAttachedFiles([]);
    setMessage("");
    setHistoryMenu(null);
    setEditingSessionId(null);
  }

  function openHistoryMenu(
    sessionId: string,
    x: number,
    y: number,
  ) {
    const menuWidth = 164;
    const menuHeight = 126;
    const padding = 8;

    setHistoryMenu({
      sessionId,
      x: Math.max(
        padding,
        Math.min(x, window.innerWidth - menuWidth - padding),
      ),
      y: Math.max(
        padding,
        Math.min(y, window.innerHeight - menuHeight - padding),
      ),
    });
  }

  function editPrompt(turn: ChatTurn) {
    const files = turn.files ?? [];
    const folderReference =
      files.find((file) => file.kind === "folder") ?? null;
    const isSameFolderStillAttached =
      folderReference &&
      projectContext?.name === folderReference.name &&
      projectContext?.folderStats?.filesIncluded ===
        folderReference.folderStats?.filesIncluded;
    const folder = isSameFolderStillAttached ? projectContext : folderReference;
    const draftFiles = files.filter((file) => file.kind !== "folder");

    setMessage(turn.content);
    setProjectContext(folder);
    setAttachedFiles(draftFiles);
    setSelectedPreviewFileId(files[0]?.id ?? null);
    setIsPreviewOpen(Boolean(files.length));
    setPreviewMode("extracted");

    window.requestAnimationFrame(() => {
      messageRef.current?.focus();
    });
  }

  async function copyResponse(content: string) {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      // Clipboard access can be unavailable in some desktop webviews.
    }
  }

  function downloadResponse(content: string) {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = `${activeSession.title || "response"}.md`.replace(
      /[\\/:*?"<>|]/g,
      "-",
    );
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function openFolderPicker() {
    if (!isTauriRuntime()) {
      folderInputRef.current?.click();
      return;
    }

    void invoke<ProjectFolderScan | null>("select_project_folder")
      .then((scan) => {
        if (scan) {
          attachFolder(createFolderAttachmentFromScan(scan));
        }
      })
      .catch(() => {
        folderInputRef.current?.click();
      });
  }

  async function rescanLiveFolder(folder: AttachedFile, required = false) {
    if (!folder.sourcePath) return folder;

    try {
      const scan = await refreshLiveFolder(folder.sourcePath);
      const refreshed = {
        ...createFolderAttachmentFromScan(scan),
        id: folder.id,
        sourcePath: folder.sourcePath,
      };
      setProjectContext((current) =>
        current?.id === folder.id ? refreshed : current,
      );
      return refreshed;
    } catch (caughtError) {
      if (required) {
        const detail =
          caughtError instanceof Error ? caughtError.message : String(caughtError);
        throw new Error(
          `The attached folder could not be refreshed${detail ? `: ${detail}` : "."}`,
        );
      }
      return folder;
    }
  }

  function clearAttachmentInputs() {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    if (folderInputRef.current) {
      folderInputRef.current.value = "";
    }
  }

  function removeFile(fileId: string) {
    if (projectContext?.id === fileId) {
      setProjectContext(null);
      return;
    }

    setAttachedFiles((current) =>
      current.filter((file) => file.id !== fileId),
    );
  }

  function clearComposerAttachmentsAfterSend() {
    setAttachedFiles([]);
    setIsPreviewOpen(false);
    setSelectedPreviewFileId(projectContext?.id ?? null);
    clearAttachmentInputs();
  }

  function applyEndpointSettings() {
    const nextEndpoint = normalizeOllamaBaseUrl(endpointDraft);

    if (!nextEndpoint) {
      setEndpointDraft(ollamaEndpoint);
      return;
    }

    setOllamaEndpoint(nextEndpoint);
  }

  async function runAssistantReply(options: {
    sessionId: string;
    baseTurns: ChatTurn[];
    visibleContent: string;
    filesForTurn: AttachedFile[];
    assistantTurnId?: string;
    userTurnId?: string;
    shouldAppendUserTurn: boolean;
    shouldClearComposerOnSuccess: boolean;
  }) {
    const {
      sessionId,
      baseTurns,
      visibleContent,
      filesForTurn,
      assistantTurnId,
      userTurnId,
      shouldAppendUserTurn,
      shouldClearComposerOnSuccess,
    } = options;

    const now = Date.now();

    const nextUserTurn: ChatTurn = {
      id: userTurnId ?? `user-${now}`,
      role: "user",
      content: visibleContent,
      files: filesForTurn,
      createdAt: now,
    };

    const nextAssistantTurn: ChatTurn = {
      id: assistantTurnId ?? `assistant-${now}`,
      role: "assistant",
      content: "",
      createdAt: now,
    };

    const automaticTitle =
      visibleContent.trim() ||
      filesForTurn[0]?.name ||
      "New chat";

    setSessions((current) =>
      current.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        if (shouldAppendUserTurn) {
          return {
            ...session,
            title:
              session.title === "New chat"
                ? automaticTitle.slice(0, 42)
                : session.title,
            turns: [
              ...session.turns,
              nextUserTurn,
              nextAssistantTurn,
            ],
            updatedAt: Date.now(),
          };
        }

        return {
          ...session,
          turns: session.turns.map((turn) =>
            turn.id === nextAssistantTurn.id
              ? {
                  ...turn,
                  content: "",
                  createdAt: turn.createdAt ?? now,
                }
              : turn,
          ),
          updatedAt: Date.now(),
        };
      }),
    );

    let shouldClearComposer = false;

    setStreamingTurnId(nextAssistantTurn.id);
    streamedTextRef.current = "";
    stickToBottomRef.current = true;

    let completedText = "";
    const folderFiles = filesForTurn.filter(
      (file) => file.kind === "folder",
    );
    const directFiles = filesForTurn.filter(
      (file) => file.kind !== "folder",
    );
    const recentContextHistory: OllamaMessage[] = baseTurns
      .filter(
        (turn) =>
          turn.content.trim() &&
          !turn.content.startsWith("Error:"),
      )
      .slice(-3)
      .map((turn) => ({
        role: turn.role,
        content: truncateContext(turn.content, 600),
      }));
    const requestSession = {
      ...activeSession,
      id: sessionId,
      turns: baseTurns,
    };
    const directPrompt = buildPrompt(visibleContent, directFiles);
    const chatMessages = buildMessages(
      requestSession,
      directPrompt,
      hardwareProfile,
      filesForTurn,
      "",
      "full",
    );

    try {
      const handleToken = (token: string) => {
        streamedTextRef.current += token;
        queueStreamPaint();
      };
      let returnedText = "";
      let shouldUseProjectContext = false;
      let retrievalQuery = visibleContent;
      let promptFolderFiles = folderFiles;
      let usedLiveWorkspaceAgent = false;

      try {
        shouldUseProjectContext = await (() => {
            if (!folderFiles.length) return Promise.resolve(false);
            const quick = quickRouteProject(directPrompt, true);
            if (quick !== null) return Promise.resolve(quick);
            return shouldReadProject(directPrompt, activeModelName, recentContextHistory);
          })();
        let requestMessages = chatMessages;

        if (shouldUseProjectContext) {
          retrievalQuery = buildProjectRetrievalQuery(
            visibleContent,
            recentContextHistory.slice(-2),
          );
          const refreshedFolderFiles = await Promise.all(
            folderFiles.map((folder) => rescanLiveFolder(folder, true)),
          );
          const currentFilesForTurn = filesForTurn.map((file) =>
            file.kind === "folder"
              ? refreshedFolderFiles.find(
                  (folder) => folder.id === file.id,
                ) ?? file
              : file,
          );
          const liveToolFolder = refreshedFolderFiles.find(
            (folder) => Boolean(folder.sourcePath),
          );

          if (liveToolFolder?.sourcePath) {
            const livePrompt = buildAttachmentAwarePrompt(
              visibleContent,
              directFiles,
              refreshedFolderFiles,
              true,
              retrievalQuery,
            );
            const liveMessages = buildMessages(
              requestSession,
              livePrompt,
              hardwareProfile,
              currentFilesForTurn,
              "",
            );
            try {
              returnedText = await runLiveWorkspaceAgent(
                liveMessages,
                activeModelName,
                async (toolName, argumentsValue) => {
                  const basePath = liveToolFolder.sourcePath as string;
                  switch (toolName) {
                    case "list_workspace_directory": {
                      const page = await browseLiveFolder(
                        basePath,
                        workspaceToolString(argumentsValue, "path"),
                        workspaceToolInteger(
                          argumentsValue,
                          "cursor",
                          0,
                          1_000_000_000,
                        ),
                        workspaceToolInteger(argumentsValue, "limit", 100, 200),
                      );
                      return JSON.stringify(page);
                    }
                    case "search_workspace_paths": {
                      const page = await searchLiveFolder(
                        basePath,
                        workspaceToolString(argumentsValue, "query"),
                        workspaceToolInteger(
                          argumentsValue,
                          "cursor",
                          0,
                          1_000_000_000,
                        ),
                        workspaceToolInteger(argumentsValue, "limit", 100, 200),
                      );
                      return JSON.stringify(page);
                    }
                    case "inspect_workspace_entries": {
                      const paths = workspaceToolPaths(argumentsValue, 64);
                      if (!paths.length) {
                        throw new Error("No paths were provided.");
                      }
                      return JSON.stringify(
                        await inspectLiveFolderEntries(basePath, paths),
                      );
                    }
                    case "read_workspace_text_files": {
                      const paths = workspaceToolPaths(argumentsValue, 8);
                      if (!paths.length) {
                        throw new Error("No paths were provided.");
                      }
                      const files = await readLiveFolderFiles(basePath, paths);
                      const excerptSize = Math.max(
                        1_000,
                        Math.floor(15_000 / Math.max(1, files.length)),
                      );
                      return files
                        .map(
                          (file) =>
                            `<live_file path=${JSON.stringify(file.path)} size=${JSON.stringify(file.size)}>\n${truncateContext(file.contents, excerptSize)}\n</live_file>`,
                        )
                        .join("\n\n");
                    }
                    case "read_workspace_text_chunk": {
                      const path = workspaceToolString(argumentsValue, "path");
                      if (!path) {
                        throw new Error("No path was provided.");
                      }
                      const chunk = await readLiveFolderFileChunk(
                        basePath,
                        path,
                        workspaceToolInteger(
                          argumentsValue,
                          "offset",
                          0,
                          Number.MAX_SAFE_INTEGER,
                        ),
                        workspaceToolInteger(
                          argumentsValue,
                          "maxBytes",
                          12_000,
                          16_000,
                        ),
                      );
                      return `<live_file_chunk path=${JSON.stringify(chunk.path)} offset=${chunk.offset} nextOffset=${chunk.nextOffset ?? "complete"} totalBytes=${chunk.totalBytes}>\n${chunk.content}\n</live_file_chunk>`;
                    }
                    case "search_workspace_content": {
                      const query = workspaceToolString(argumentsValue, "query");
                      if (!query) throw new Error("No query was provided.");
                      const sensitive = argumentsValue["caseSensitive"] === true;
                      const results = await searchLiveFolderContents(
                        basePath,
                        query,
                        sensitive,
                        workspaceToolInteger(argumentsValue, "cursor", 0, 1_000_000_000),
                        workspaceToolInteger(argumentsValue, "limit", 20, 50),
                      );
                      return JSON.stringify(results);
                    }
                    case "write_workspace_file": {
                      const filePath = workspaceToolString(argumentsValue, "path");
                      const fileContent = typeof argumentsValue["content"] === "string"
                        ? (argumentsValue["content"] as string)
                        : "";
                      if (!filePath) throw new Error("No path was provided.");
                      if (!fileContent) throw new Error("No content was provided.");
                      const wr = await writeWorkspaceFile(basePath, filePath, fileContent);
                      return JSON.stringify(wr);
                    }
                    default:
                      throw new Error(
                        `Unknown workspace tool: ${toolName || "unnamed"}`,
                      );
                  }
                },
                handleToken,
                buildGenerationOptions(currentFilesForTurn),
                setWorkspaceActivity,
              );
              promptFolderFiles = refreshedFolderFiles;
              usedLiveWorkspaceAgent = true;
            } catch (workspaceAgentError) {
              if (
                workspaceAgentError instanceof Error &&
                workspaceAgentError.message === "Generation canceled."
              ) {
                throw workspaceAgentError;
              }
            }
          }

          if (!usedLiveWorkspaceAgent) {
            promptFolderFiles = await Promise.all(
              refreshedFolderFiles.map(async (folder) => {
                if (!folder.sourcePath || !folder.liveEntries?.length) {
                  return folder;
                }

                let selectedPaths: string[];
                try {
                  selectedPaths = await selectProjectFiles(
                    retrievalQuery,
                    activeModelName,
                    folder.liveEntries,
                  );
                  if (
                    !selectedPaths.length &&
                    liveFolderQueryNeedsContents(retrievalQuery)
                  ) {
                    selectedPaths = selectLiveFolderPaths(
                      folder,
                      retrievalQuery,
                    );
                  }
                } catch (selectionError) {
                  if (
                    selectionError instanceof Error &&
                    selectionError.message === "Generation canceled."
                  ) {
                    throw selectionError;
                  }
                  selectedPaths = selectLiveFolderPaths(folder, retrievalQuery);
                }

                if (!selectedPaths.length) return folder;

                try {
                  let liveFiles = await readLiveFolderFiles(
                    folder.sourcePath,
                    selectedPaths,
                  );
                  if (liveFiles.length < 8) {
                    try {
                      const followUpPaths = await selectProjectFiles(
                        retrievalQuery,
                        activeModelName,
                        folder.liveEntries,
                        liveFiles,
                      );
                      if (followUpPaths.length) {
                        const followUpFiles = await readLiveFolderFiles(
                          folder.sourcePath,
                          followUpPaths.slice(0, 8 - liveFiles.length),
                        );
                        liveFiles = [...liveFiles, ...followUpFiles];
                      }
                    } catch (followUpError) {
                      if (
                        followUpError instanceof Error &&
                        followUpError.message === "Generation canceled."
                      ) {
                        throw followUpError;
                      }
                    }
                  }
                  return hydrateLiveFolderAttachment(folder, liveFiles);
                } catch {
                  return folder;
                }
              }),
            );

            const modelPrompt = buildAttachmentAwarePrompt(
              visibleContent,
              directFiles,
              promptFolderFiles,
              false,
              retrievalQuery,
            );

            requestMessages = buildMessages(
              requestSession,
              modelPrompt,
              hardwareProfile,
              currentFilesForTurn,
              "",
            );
          }
        }

        if (!usedLiveWorkspaceAgent) {
          returnedText = await streamChat(
            requestMessages,
            activeModelName,
            handleToken,
            buildGenerationOptions(
              shouldUseProjectContext ? filesForTurn : directFiles,
            ),
          );
        }
      } catch (primaryError) {
        const errorMessage =
          primaryError instanceof Error ? primaryError.message : "";
        const shouldRetry =
          errorMessage.toLowerCase().includes("empty response");

        if (!shouldRetry) {
          throw primaryError;
        }

        streamedTextRef.current = "";
        queueStreamPaint();

        const compactPrompt = shouldUseProjectContext
          ? buildAttachmentAwarePrompt(
              visibleContent,
              directFiles,
              promptFolderFiles,
              true,
              retrievalQuery,
            )
          : buildCompactPrompt(visibleContent, directFiles);
        const compactBackgroundContext = shouldUseProjectContext
          ? buildBackgroundContext(promptFolderFiles, true, retrievalQuery)
          : "";
        const compactMessages = buildMessages(
          requestSession,
          compactPrompt,
          hardwareProfile,
          shouldUseProjectContext ? filesForTurn : directFiles,
          compactBackgroundContext,
          shouldUseProjectContext ? "full" : "none",
        );

        returnedText = await streamChat(
          compactMessages,
          activeModelName,
          handleToken,
        );
      }

      completedText =
        (typeof returnedText === "string"
          ? returnedText.trim()
          : "") ||
        streamedTextRef.current.trim();

      if (!completedText) {
        throw new Error("The local model returned no content.");
      }

      shouldClearComposer = shouldClearComposerOnSuccess;
    } catch (sendError) {
      const errorMessage =
        sendError instanceof Error
          ? sendError.message
          : "Could not connect to the local assistant.";

      if (errorMessage === "Generation canceled.") {
        completedText = streamedTextRef.current.trim();
      } else {
        completedText = `Error: ${errorMessage}`;
      }
    } finally {
      if (streamFrameRef.current !== null) {
        window.cancelAnimationFrame(
          streamFrameRef.current,
        );

        streamFrameRef.current = null;
      }

      if (completedText) {
        updateTurnContent(
          sessionId,
          nextAssistantTurn.id,
          completedText,
        );
      } else {
        removeTurn(sessionId, nextAssistantTurn.id);
      }

      if (shouldClearComposer) {
        setMessage("");
        clearComposerAttachmentsAfterSend();
      }

      streamedTextRef.current = "";
      setStreamingTurnId(null);
      setIsCanceling(false);
      setWorkspaceActivity("");
    }
  }

  async function sendMessage() {
    const trimmedMessage = message.trim();

    const hasSendableAttachment = attachedFiles.some(
      (file) => file.kind === "file",
    );

    if (!trimmedMessage && !hasSendableAttachment) {
      if (message) {
        setMessage("");
      }
      return;
    }

    if (
      isGenerating ||
      isCanceling ||
      !activeSession ||
      !activeModelName
    ) {
      return;
    }

    const filesForTurn = contextAttachments;

    const visibleContent =
      trimmedMessage ||
      `Attached ${filesForTurn.length} file(s).`;

    await runAssistantReply({
      sessionId: activeSession.id,
      baseTurns: activeSession.turns,
      visibleContent,
      filesForTurn,
      shouldAppendUserTurn: true,
      shouldClearComposerOnSuccess: true,
    });
  }

  async function regenerateLastResponse() {
    if (
      isGenerating ||
      isCanceling ||
      !activeModelName ||
      !regenerateTarget
    ) {
      return;
    }

    await runAssistantReply({
      sessionId: activeSession.id,
      baseTurns: regenerateTarget.historyBeforeUserTurn,
      visibleContent: regenerateTarget.userTurn.content,
      filesForTurn: (regenerateTarget.userTurn.files ?? []).map((file) =>
        file.kind === "folder" &&
        projectContext?.name === file.name
          ? projectContext
          : file,
      ),
      assistantTurnId: regenerateTarget.assistantTurn.id,
      shouldAppendUserTurn: false,
      shouldClearComposerOnSuccess: false,
    });
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void sendMessage();
    }
  }

  function handleResponseScroll() {
    const responseLog = responseLogRef.current;
    if (!responseLog) return;

    const distanceFromBottom =
      responseLog.scrollHeight -
      responseLog.scrollTop -
      responseLog.clientHeight;

    stickToBottomRef.current =
      distanceFromBottom < 80;
  }

  function handleDragEnter(
    event: DragEvent<HTMLElement>,
  ) {
    if (!hasDraggedFiles(event)) return;

    event.preventDefault();

    dragDepthRef.current += 1;
    setIsDragging(true);
  }

  function handleDragOver(
    event: DragEvent<HTMLElement>,
  ) {
    if (!hasDraggedFiles(event)) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(
    event: DragEvent<HTMLElement>,
  ) {
    if (!hasDraggedFiles(event)) return;

    event.preventDefault();

    dragDepthRef.current = Math.max(
      0,
      dragDepthRef.current - 1,
    );

    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    if (!hasDraggedFiles(event)) return;

    event.preventDefault();

    dragDepthRef.current = 0;
    setIsDragging(false);

    if (event.dataTransfer.files.length) {
      const droppedFiles = Array.from(event.dataTransfer.files);
      const includesRelativePaths = droppedFiles.some((file) => {
        const relativePath = (file as File & { webkitRelativePath?: string })
          .webkitRelativePath;
        return Boolean(relativePath && relativePath.includes("/"));
      });

      if (includesRelativePaths) {
        void addBrowserFolder(droppedFiles);
      } else {
        void addFiles(droppedFiles);
      }
    }
  }

  const setupStatusLabel = error
    ? error
    : availableModelNames.length
      ? `${availableModelNames.length} model${availableModelNames.length === 1 ? "" : "s"} available.`
      : "No models found yet. Install or pull a local model to continue.";

  return (
    <main
      className={`app-shell theme-${theme}${
        isSidebarCollapsed ? " sidebar-collapsed" : ""
      }${
        isDragging ? " dragging" : ""
      }`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging ? (
        <div
          className="drag-overlay"
          aria-hidden="true"
        >
          <div className="drag-overlay-panel">
            <strong>Drop files here</strong>
            <span>
              Text files include previews. Use Attach folder for project context.
            </span>
          </div>
        </div>
      ) : null}

      <Sidebar
        activeSessionId={activeSession.id}
        collapsedPreviewSessions={collapsedPreviewSessions}
        draftTitle={draftTitle}
        editingSessionId={editingSessionId}
        historyMenu={historyMenu}
        historySections={historySections}
        isCollapsed={isSidebarCollapsed}
        isSettingsOpen={isSettingsOpen}
        onCancelRename={() => setEditingSessionId(null)}
        onCollapseChange={setIsSidebarCollapsed}
        onCommitRename={commitRename}
        onCreateChat={createNewChat}
        onDeleteSession={deleteSession}
        onDraftTitleChange={setDraftTitle}
        onDuplicateSession={duplicateSession}
        onOpenHistoryMenu={openHistoryMenu}
        onSelectSession={selectSession}
        onStartRename={startRename}
        onToggleSettings={() =>
          setIsSettingsOpen((current) => !current)
        }
      />

      <section className="workspace">
        <header className="workspace-header">
          <div className="header-actions">
            <div className="header-toolbar">
              <ModelSelector
                activeModelName={activeModelName}
                availableModelNames={availableModelNames}
                isGenerating={isGenerating}
                isOpen={isModelMenuOpen}
                onOpenChange={setIsModelMenuOpen}
                onSelect={(modelName) => {
                  setSelectedModelName(modelName);
                  setIsModelMenuOpen(false);
                }}
              />
            </div>
          </div>

          {error ? (
            <div className="ollama-error-banner" role="alert">
              <span>Error: {error}</span>
            </div>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".txt,.md,.rtf,.docx,.ts,.tsx,.js,.jsx,.mjs,.py,.pyi,.rs,.go,.java,.kt,.c,.cpp,.h,.cs,.swift,.rb,.php,.sh,.ps1,.sql,.html,.css,.scss,.json,.yaml,.yml,.toml,.xml,.csv,.tsv,.log,.conf,.ini,text/plain,text/markdown,text/rtf,application/rtf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(event) => {
              void addFiles(
                event.currentTarget.files ?? [],
              );

              event.currentTarget.value = "";
            }}
            className="file-input"
            aria-hidden="true"
            tabIndex={-1}
          />

          <input
            ref={folderInputRef}
            type="file"
            multiple
            onChange={(event) => {
              void addBrowserFolder(
                event.currentTarget.files ?? [],
              );

              event.currentTarget.value = "";
            }}
            className="file-input"
            aria-hidden="true"
            tabIndex={-1}
            {...folderInputAttributes}
          />
        </header>

        {isSettingsOpen ? (
          <SettingsPanel
            activeModelName={activeModelName}
            availableModelNames={availableModelNames}
            endpointDraft={endpointDraft}
            hardwareProfile={hardwareProfile}
            isGenerating={isGenerating}
            setupStatusLabel={setupStatusLabel}
            theme={theme}
            onApplyEndpoint={applyEndpointSettings}
            onClose={() => setIsSettingsOpen(false)}
            onEndpointChange={setEndpointDraft}
            onHardwareProfileChange={setHardwareProfile}
            onModelChange={setSelectedModelName}
            onRefreshModels={() => {
              void refreshModels();
            }}
            onThemeChange={setTheme}
          />
        ) : (
        <section className="card chat-canvas">
          {activeSession.turns.length === 0 ? (
            <div className="canvas-greeting">
              <span className="greeting-mark" aria-hidden="true">✦</span>
              <h3>{emptyStateContent.title}</h3>

              <p>{emptyStateContent.description}</p>

            </div>
          ) : (
            <div className="active-chat-heading">
              {editingSessionId === activeSession.id ? (
                <input
                  className="active-chat-title-input"
                  value={draftTitle}
                  autoFocus
                  onChange={(event) =>
                    setDraftTitle(event.currentTarget.value)
                  }
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }

                    if (event.key === "Escape") {
                      setEditingSessionId(null);
                    }
                  }}
                  aria-label="Chat title"
                />
              ) : (
                <>
                  <strong>{activeSession.title}</strong>

                  <button
                    type="button"
                    className="active-chat-title-edit"
                    onClick={() => startRename(activeSession.id)}
                    aria-label="Edit chat title"
                    title="Edit chat title"
                  >
                    <EditIcon className="ui-icon" />
                  </button>
                </>
              )}

              {isGenerating ? (
                <small>Generating</small>
              ) : null}
            </div>
          )}

          {selectedPreviewFile ? (
            <FilePreview
              activePreviewText={activePreviewText}
              attachments={contextAttachments}
              isOpen={isPreviewOpen}
              previewMode={previewMode}
              selectedFile={selectedPreviewFile}
              onDetach={removeFile}
              onOpenChange={setIsPreviewOpen}
              onPreviewModeChange={setPreviewMode}
              onSelectFile={setSelectedPreviewFileId}
            />
          ) : null}

          <ConversationLog
            activeModelName={activeModelName}
            canRegenerateAssistantTurnId={
              regenerateTarget?.assistantTurn.id
            }
            isGenerating={isGenerating}
            generationActivity={workspaceActivity}
            responseLogRef={responseLogRef}
            session={activeSession}
            streamingTextElementRef={streamingTextElementRef}
            streamingTurnId={streamingTurnId}
            folderPath={projectContext?.sourcePath}
            onFilesystemApplied={() => {
              if (projectContext) {
                void rescanLiveFolder(projectContext);
              }
            }}
            onCopyResponse={(content) => {
              void copyResponse(content);
            }}
            onDownloadResponse={downloadResponse}
            onEditPrompt={editPrompt}
            onRegenerate={() => {
              void regenerateLastResponse();
            }}
            onScroll={handleResponseScroll}
          />

          <MessageComposer
            attachedFiles={attachedFiles}
            canSend={canSend}
            isExpanded={isComposerExpanded}
            isGenerating={isGenerating}
            message={message}
            messageRef={messageRef}
            onAttach={openFilePicker}
            onAttachFolder={openFolderPicker}
            onCancel={() => {
              setIsCanceling(true);
              cancelChat();
            }}
            onKeyDown={handleKeyDown}
            onMessageChange={setMessage}
            onRemoveFile={removeFile}
            onSend={() => {
              void sendMessage();
            }}
          />
        </section>
        )}
      </section>
    </main>
  );
}

export default App;
