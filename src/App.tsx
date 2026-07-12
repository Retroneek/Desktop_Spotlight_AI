import {
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useOllama } from "./services/ollama";
import "./App.css";

const presets = [
  {
    id: "lite",
    label: "Lite",
    description: "Fast answers for smaller files and quick summaries.",
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Default mix of speed and reasoning depth.",
  },
  {
    id: "pro",
    label: "Pro",
    description: "Best for longer prompts and more careful analysis.",
  },
] as const;

type PresetId = (typeof presets)[number]["id"];
type Theme = "dark" | "light";

type AttachedFile = {
  id: string;
  name: string;
  typeLabel: string;
  sizeLabel: string;
  preview: string;
  supported: boolean;
};

type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  files?: AttachedFile[];
};

type ChatSession = {
  id: string;
  title: string;
  turns: ChatTurn[];
  createdAt: number;
  updatedAt: number;
};

type OllamaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type HistoryMenuState = {
  sessionId: string;
  x: number;
  y: number;
};

const storageKey = "desktop-spotlight-ai-chats";
const activeChatStorageKey = "desktop-spotlight-ai-active-chat";
const attachmentStorageKey = "desktop-spotlight-ai-attached-files";
const modelStorageKey = "desktop-spotlight-ai-model";
const themeStorageKey = "desktop-spotlight-ai-theme";

const maxMessageLines = 10;
const lineHeight = 18;
const verticalPadding = 10;
const maxMessageHeight = lineHeight * maxMessageLines + verticalPadding;

const presetSystemPrompts: Record<PresetId, string> = {
  lite: `
You are Desktop Spotlight AI, a fast local desktop assistant.
Give concise, practical answers.
Prioritize attached file content when files are included.
Do not invent information that is not present.
`.trim(),

  balanced: `
You are Desktop Spotlight AI, a helpful local desktop assistant.
Give clear, direct answers with enough explanation to be useful.
Prioritize attached file content when files are included.
Do not invent information that is not present.
`.trim(),

  pro: `
You are Desktop Spotlight AI, a careful local desktop assistant.
Give thorough, structured answers and explain important tradeoffs.
Prioritize attached file content when files are included.
Do not invent information that is not present.
`.trim(),
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createSession(title = "New chat"): ChatSession {
  const now = Date.now();

  return {
    id: createId("chat"),
    title,
    turns: [],
    createdAt: now,
    updatedAt: now,
  };
}

function getInitialSessions(): ChatSession[] {
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return [createSession()];

    const parsed = JSON.parse(stored) as ChatSession[];

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [createSession()];
    }

    return parsed.map((session) => ({
      ...session,
      title: typeof session.title === "string" ? session.title : "New chat",
      turns: Array.isArray(session.turns) ? session.turns : [],
      createdAt:
        typeof session.createdAt === "number"
          ? session.createdAt
          : Date.now(),
      updatedAt:
        typeof session.updatedAt === "number"
          ? session.updatedAt
          : Date.now(),
    }));
  } catch {
    return [createSession()];
  }
}

function getInitialAttachedFiles(): AttachedFile[] {
  try {
    const stored = localStorage.getItem(attachmentStorageKey);
    if (!stored) return [];

    const parsed = JSON.parse(stored) as AttachedFile[];
    if (!Array.isArray(parsed)) return [];

    return parsed.map((file) => ({
      id: typeof file.id === "string" ? file.id : createId("file"),
      name: typeof file.name === "string" ? file.name : "Untitled file",
      typeLabel:
        typeof file.typeLabel === "string" ? file.typeLabel : "file",
      sizeLabel:
        typeof file.sizeLabel === "string" ? file.sizeLabel : "0 B",
      preview: typeof file.preview === "string" ? file.preview : "",
      supported: Boolean(file.supported),
    }));
  } catch {
    return [];
  }
}

function getInitialAppState() {
  const sessions = getInitialSessions();

  try {
    const storedActiveId = localStorage.getItem(activeChatStorageKey);

    const activeSessionId =
      storedActiveId &&
      sessions.some((session) => session.id === storedActiveId)
        ? storedActiveId
        : sessions[0].id;

    return {
      sessions,
      activeSessionId,
    };
  } catch {
    return {
      sessions,
      activeSessionId: sessions[0].id,
    };
  }
}

function getInitialTheme(): Theme {
  try {
    return localStorage.getItem(themeStorageKey) === "light"
      ? "light"
      : "dark";
  } catch {
    return "dark";
  }
}

function getInitialModel() {
  try {
    return localStorage.getItem(modelStorageKey) ?? "";
  } catch {
    return "";
  }
}

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isSupportedTextFile(file: File) {
  const lowerName = file.name.toLowerCase();

  return (
    file.type === "text/plain" ||
    file.type === "text/markdown" ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".md")
  );
}

async function summarizeFile(file: File): Promise<AttachedFile> {
  const supported = isSupportedTextFile(file);

  const typeLabel =
    file.type ||
    (file.name.toLowerCase().endsWith(".md")
      ? "text/markdown"
      : "file");

  let preview = "Preview unavailable for this file type.";

  if (supported) {
    const text = await file.text();

    preview = text.trim()
      ? text.trim().slice(0, 2500)
      : "Empty text file.";
  }

  return {
    id: `${file.name}-${file.lastModified}-${file.size}`,
    name: file.name,
    typeLabel,
    sizeLabel: formatFileSize(file.size),
    preview,
    supported,
  };
}

function getModelName(model: unknown) {
  if (typeof model === "string") {
    return model;
  }

  if (typeof model === "object" && model !== null) {
    const candidate = model as {
      name?: unknown;
      model?: unknown;
    };

    if (typeof candidate.name === "string") {
      return candidate.name;
    }

    if (typeof candidate.model === "string") {
      return candidate.model;
    }
  }

  return undefined;
}

function getModelList(models: unknown) {
  if (Array.isArray(models)) {
    return models;
  }

  if (typeof models === "object" && models !== null) {
    const candidate = models as {
      models?: unknown;
    };

    if (Array.isArray(candidate.models)) {
      return candidate.models;
    }
  }

  return [];
}

function buildPrompt(content: string, files: AttachedFile[]) {
  if (!files.length) {
    return content;
  }

  const fileContext = files
    .map((file) => {
      const fileText = file.supported
        ? file.preview
        : "The contents of this file type could not be read.";

      return [
        `File: ${file.name}`,
        `Type: ${file.typeLabel}`,
        `Size: ${file.sizeLabel}`,
        "Contents:",
        fileText,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  return `${content}

Attached file context:

${fileContext}`;
}

function buildMessages(
  session: ChatSession,
  prompt: string,
  preset: PresetId,
  modelName: string,
): OllamaMessage[] {
  const recentMessages: OllamaMessage[] = session.turns
    .filter((turn) => turn.content.trim())
    .slice(-12)
    .map((turn) => ({
      role: turn.role,
      content: turn.content,
    }));

  const identityPrompt = `
${presetSystemPrompts[preset]}

You are running locally through Ollama using the model "${modelName}".
If asked which model you are using, identify yourself as the selected local Ollama model.
Do not claim to be GPT-4, ChatGPT, or an OpenAI model.
`.trim();

  return [
    {
      role: "system",
      content: identityPrompt,
    },
    ...recentMessages,
    {
      role: "user",
      content: prompt,
    },
  ];
}

function App() {
  const initialStateRef = useRef(getInitialAppState());

  const {
    models,
    streamChat,
    isGenerating,
    error,
  } = useOllama();

  const [preset, setPreset] = useState<PresetId>("balanced");
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  const [sessions, setSessions] = useState<ChatSession[]>(
    initialStateRef.current.sessions,
  );

  const [activeSessionId, setActiveSessionId] = useState(
    initialStateRef.current.activeSessionId,
  );

  const [selectedModelName, setSelectedModelName] =
    useState(getInitialModel);

  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>(
    getInitialAttachedFiles,
  );

  const [message, setMessage] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const [historyMenu, setHistoryMenu] =
    useState<HistoryMenuState | null>(null);

  const [editingSessionId, setEditingSessionId] =
    useState<string | null>(null);

  const [draftTitle, setDraftTitle] = useState("");
  const [streamingTurnId, setStreamingTurnId] =
    useState<string | null>(null);

  const messageRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const responseLogRef = useRef<HTMLDivElement>(null);
  const streamingTextElementRef = useRef<HTMLParagraphElement>(null);

  const dragDepthRef = useRef(0);
  const streamedTextRef = useRef("");
  const streamFrameRef = useRef<number | null>(null);
  const stickToBottomRef = useRef(true);

  const availableModelNames = useMemo(() => {
    return getModelList(models)
      .map(getModelName)
      .filter((name): name is string => Boolean(name));
  }, [models]);

  const activeModelName =
    selectedModelName || availableModelNames[0] || "";

  const activeSession = useMemo(() => {
    return (
      sessions.find((session) => session.id === activeSessionId) ??
      sessions[0]
    );
  }, [activeSessionId, sessions])!;

  const selectedPreset =
    presets.find((option) => option.id === preset) ?? presets[1];

  const hasPrompt =
    message.trim().length > 0 || attachedFiles.length > 0;

  const canSend =
    !isGenerating &&
    Boolean(activeModelName) &&
    hasPrompt;

  const canSummarize =
    !isGenerating &&
    Boolean(activeModelName) &&
    attachedFiles.length > 0;

  useEffect(() => {
    if (!availableModelNames.length) {
      if (selectedModelName) {
        setSelectedModelName("");
      }

      return;
    }

    if (!availableModelNames.includes(selectedModelName)) {
      setSelectedModelName(availableModelNames[0]);
    }
  }, [availableModelNames, selectedModelName]);

  useEffect(() => {
    const saveTimer = window.setTimeout(() => {
      localStorage.setItem(storageKey, JSON.stringify(sessions));
    }, 250);

    return () => {
      window.clearTimeout(saveTimer);
    };
  }, [sessions]);

  useEffect(() => {
    const saveTimer = window.setTimeout(() => {
      localStorage.setItem(
        attachmentStorageKey,
        JSON.stringify(attachedFiles),
      );
    }, 250);

    return () => {
      window.clearTimeout(saveTimer);
    };
  }, [attachedFiles]);

  useEffect(() => {
    localStorage.setItem(activeChatStorageKey, activeSessionId);
  }, [activeSessionId]);

  useEffect(() => {
    localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  useEffect(() => {
    if (selectedModelName) {
      localStorage.setItem(modelStorageKey, selectedModelName);
    }
  }, [selectedModelName]);

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
    }

    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;

      setHistoryMenu(null);
      setEditingSessionId(null);
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

    textarea.style.height = `${nextHeight}px`;

    textarea.style.overflowY =
      textarea.scrollHeight > maxMessageHeight
        ? "auto"
        : "hidden";
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

  function queueStreamPaint() {
    if (streamFrameRef.current !== null) {
      return;
    }

    streamFrameRef.current = window.requestAnimationFrame(() => {
      const textElement = streamingTextElementRef.current;
      const responseLog = responseLogRef.current;

      if (textElement) {
        textElement.textContent =
          streamedTextRef.current || "Thinking...";
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
      fileArray.map((file) => summarizeFile(file)),
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

  function createNewChat() {
    const nextSession = createSession();

    setSessions((current) => [
      nextSession,
      ...current,
    ]);

    setActiveSessionId(nextSession.id);
    setAttachedFiles([]);
    setMessage("");
    setHistoryMenu(null);
    setEditingSessionId(null);
  }

  function selectSession(sessionId: string) {
    setActiveSessionId(sessionId);
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

  function cyclePreset() {
    const currentIndex = presets.findIndex(
      (option) => option.id === preset,
    );

    const nextPreset =
      presets[(currentIndex + 1) % presets.length];

    setPreset(nextPreset.id);
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function removeFile(fileId: string) {
    setAttachedFiles((current) =>
      current.filter((file) => file.id !== fileId),
    );
  }

  async function sendMessage(summarize = false) {
    const trimmedMessage = message.trim();

    if (!trimmedMessage && attachedFiles.length === 0) {
      return;
    }

    if (
      isGenerating ||
      !activeSession ||
      !activeModelName
    ) {
      return;
    }

    const sessionId = activeSession.id;
    const filesForTurn = attachedFiles;

    const visibleContent = summarize
      ? trimmedMessage
        ? `Please summarize the attached file(s) and answer: ${trimmedMessage}`
        : "Please summarize the attached file(s)."
      : trimmedMessage ||
        `Attached ${filesForTurn.length} file(s).`;

    const modelPrompt = buildPrompt(
      visibleContent,
      filesForTurn,
    );

    const messages = buildMessages(
      activeSession,
      modelPrompt,
      preset,
      activeModelName,
    );

    const now = Date.now();

    const userTurn: ChatTurn = {
      id: `user-${now}`,
      role: "user",
      content: visibleContent,
      files: filesForTurn,
    };

    const assistantTurn: ChatTurn = {
      id: `assistant-${now}`,
      role: "assistant",
      content: "Thinking...",
    };

    const automaticTitle =
      trimmedMessage ||
      filesForTurn[0]?.name ||
      "New chat";

    setSessions((current) =>
      current.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        return {
          ...session,
          title:
            session.title === "New chat"
              ? automaticTitle.slice(0, 42)
              : session.title,
          turns: [
            ...session.turns,
            userTurn,
            assistantTurn,
          ],
          updatedAt: Date.now(),
        };
      }),
    );

    setMessage("");
    setAttachedFiles([]);
    setStreamingTurnId(assistantTurn.id);

    streamedTextRef.current = "";
    stickToBottomRef.current = true;

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    let completedText = "";

    try {
      const returnedText = await streamChat(
        messages,
        activeModelName,
        (token: string) => {
          streamedTextRef.current += token;
          queueStreamPaint();
        },
      );

      completedText =
        (typeof returnedText === "string"
          ? returnedText.trim()
          : "") ||
        streamedTextRef.current.trim() ||
        "No response returned from Ollama.";
    } catch (sendError) {
      const errorMessage =
        sendError instanceof Error
          ? sendError.message
          : "Could not connect to Ollama.";

      completedText = `Ollama error: ${errorMessage}`;
    } finally {
      if (streamFrameRef.current !== null) {
        window.cancelAnimationFrame(
          streamFrameRef.current,
        );

        streamFrameRef.current = null;
      }

      updateTurnContent(
        sessionId,
        assistantTurn.id,
        completedText,
      );

      streamedTextRef.current = "";
      setStreamingTurnId(null);
    }
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
    event.preventDefault();

    dragDepthRef.current += 1;
    setIsDragging(true);
  }

  function handleDragOver(
    event: DragEvent<HTMLElement>,
  ) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(
    event: DragEvent<HTMLElement>,
  ) {
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
    event.preventDefault();

    dragDepthRef.current = 0;
    setIsDragging(false);

    void addFiles(event.dataTransfer.files);
  }

  return (
    <main
      className={`app-shell theme-${theme}${
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
            <strong>Drop file here</strong>
            <span>Release to attach your file</span>
          </div>
        </div>
      ) : null}

      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>Recent chats</h2>

          <button
            type="button"
            className="sidebar-new-button"
            onClick={createNewChat}
            aria-label="Create new chat"
          >
            +
          </button>
        </div>

        <div
          className="history-list"
          role="list"
          aria-label="Previous chat history"
        >
          {sessions.map((session) => (
            <div
              key={session.id}
              className={
                session.id === activeSession.id
                  ? "history-item-shell active"
                  : "history-item-shell"
              }
              onContextMenu={(event) => {
                event.preventDefault();

                openHistoryMenu(
                  session.id,
                  event.clientX,
                  event.clientY,
                );
              }}
            >
              {editingSessionId === session.id ? (
                <input
                  className="history-rename-input"
                  value={draftTitle}
                  autoFocus
                  onPointerDown={(event) =>
                    event.stopPropagation()
                  }
                  onChange={(event) =>
                    setDraftTitle(
                      event.currentTarget.value,
                    )
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
                />
              ) : (
                <button
                  type="button"
                  className="history-item"
                  onClick={() =>
                    selectSession(session.id)
                  }
                  onDoubleClick={() =>
                    startRename(session.id)
                  }
                  aria-pressed={
                    session.id === activeSession.id
                  }
                >
                  <span className="history-item-title">
                    {session.title}
                  </span>
                </button>
              )}

              <button
                type="button"
                className="history-options-button"
                aria-label={`More options for ${session.title}`}
                onClick={(event) => {
                  event.stopPropagation();

                  const rect =
                    event.currentTarget.getBoundingClientRect();

                  openHistoryMenu(
                    session.id,
                    rect.right - 164,
                    rect.bottom + 6,
                  );
                }}
              >
                ⋯
              </button>
            </div>
          ))}
        </div>
      </aside>

      {historyMenu ? (
        <div
          className="history-menu"
          style={{
            left: historyMenu.x,
            top: historyMenu.y,
          }}
          role="menu"
          onPointerDown={(event) =>
            event.stopPropagation()
          }
        >
          <button
            type="button"
            className="history-menu-item"
            onClick={() =>
              startRename(historyMenu.sessionId)
            }
          >
            Rename
          </button>

          <button
            type="button"
            className="history-menu-item"
            onClick={() =>
              duplicateSession(historyMenu.sessionId)
            }
          >
            Duplicate
          </button>

          <button
            type="button"
            className="history-menu-item danger"
            onClick={() =>
              deleteSession(historyMenu.sessionId)
            }
          >
            Delete
          </button>
        </div>
      ) : null}

      <section className="workspace">
        <header className="workspace-header">
          <div className="header-actions">
            {availableModelNames.length ? (
              <select
                className="model-select"
                value={activeModelName}
                disabled={isGenerating}
                onChange={(event) =>
                  setSelectedModelName(
                    event.currentTarget.value,
                  )
                }
                aria-label="Select Ollama model"
                title={
                  error ??
                  `Using ${activeModelName} through Ollama`
                }
              >
                {availableModelNames.map(
                  (modelName) => (
                    <option
                      key={modelName}
                      value={modelName}
                    >
                      {modelName}
                    </option>
                  ),
                )}
              </select>
            ) : (
              <span
                className={
                  error
                    ? "ollama-status error"
                    : "ollama-status"
                }
                title={error ?? undefined}
              >
                {error
                  ? "Ollama error"
                  : "No model found"}
              </span>
            )}

            <button
              type="button"
              className="theme-toggle"
              onClick={() =>
                setTheme((current) =>
                  current === "dark"
                    ? "light"
                    : "dark",
                )
              }
              aria-pressed={theme === "light"}
            >
              {theme === "dark" ? "Light" : "Dark"}
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".txt,.md,text/plain,text/markdown"
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
        </header>

        <section className="card chat-canvas">
          {activeSession.turns.length === 0 ? (
            <div className="canvas-greeting">
              <h3>Hi, what can I help with today?</h3>

              <p>
                Drop a file anywhere, select a model,
                and ask a question.
              </p>
            </div>
          ) : (
            <div className="active-chat-heading">
              <span>{activeSession.title}</span>

              <small>
                {isGenerating
                  ? "Generating response…"
                  : activeModelName}
              </small>
            </div>
          )}

          <div className="response-panel">
            <div
              ref={responseLogRef}
              className="response-log"
              onScroll={handleResponseScroll}
            >
              {activeSession.turns.length ? (
                activeSession.turns.map((turn) => {
                  const isStreamingTurn =
                    turn.id === streamingTurnId;

                  return (
                    <div
                      key={turn.id}
                      className={`turn turn-${turn.role}${
                        isStreamingTurn
                          ? " streaming"
                          : ""
                      }`}
                    >
                      {turn.files?.length ? (
                        <div className="message-attachments">
                          {turn.files.map((file) => (
                            <div
                              key={file.id}
                              className="message-attachment"
                            >
                              <strong>
                                {file.name}
                              </strong>

                              <span>
                                {file.typeLabel} ·{" "}
                                {file.sizeLabel}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      <p
                        ref={
                          isStreamingTurn
                            ? streamingTextElementRef
                            : undefined
                        }
                      >
                        {turn.content}
                      </p>
                    </div>
                  );
                })
              ) : (
                <p className="response-empty">
                  Your first message will create a local
                  Ollama response.
                </p>
              )}
            </div>
          </div>

          <div className="composer-stack">
            {attachedFiles.length ? (
              <div
                className="pending-attachments"
                aria-label="Files ready to send"
              >
                {attachedFiles.map((file) => (
                  <div
                    key={file.id}
                    className="pending-attachment"
                  >
                    <div className="pending-file-details">
                      <strong>{file.name}</strong>
                      <span>{file.sizeLabel}</span>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        removeFile(file.id)
                      }
                      aria-label={`Remove ${file.name}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div
              className="composer-shell"
              aria-label="Message composer"
            >
              <button
                type="button"
                className="attach-button"
                aria-label="Attach file"
                disabled={isGenerating}
                onClick={openFilePicker}
              >
                +
              </button>

              <textarea
                ref={messageRef}
                className="prompt-box"
                placeholder="Message Desktop Spotlight AI"
                rows={1}
                value={message}
                disabled={isGenerating}
                onChange={(event) =>
                  setMessage(event.currentTarget.value)
                }
                onKeyDown={handleKeyDown}
              />

              <button
                type="button"
                className="preset-pill-button"
                disabled={isGenerating}
                aria-label={`Current preset ${selectedPreset.label}`}
                title={selectedPreset.description}
                onClick={cyclePreset}
              >
                {selectedPreset.label}
              </button>

              <button
                type="button"
                className="summarize-button"
                aria-label="Summarize attached files"
                disabled={!canSummarize}
                onClick={() =>
                  void sendMessage(true)
                }
              >
                <span className="label-full">
                  Summary
                </span>

                <span className="label-short">
                  Sum
                </span>
              </button>

              <button
                type="button"
                className="send-button"
                aria-label="Send"
                disabled={!canSend}
                onClick={() =>
                  void sendMessage()
                }
              >
                {isGenerating ? "…" : "Send"}
              </button>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

export default App;