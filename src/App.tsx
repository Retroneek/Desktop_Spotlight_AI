import { type DragEvent, type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import "./App.css";

const presets = [
  { id: "lite", label: "Lite", description: "Fast answers for smaller files and quick summaries." },
  { id: "balanced", label: "Balanced", description: "Default mix of speed and reasoning depth." },
  { id: "pro", label: "Pro", description: "Best for longer prompts and more careful analysis." },
] as const;

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

const storageKey = "desktop-spotlight-ai-chats";
const attachmentStorageKey = "desktop-spotlight-ai-attached-files";
const maxMessageLines = 10;
const lineHeight = 18;
const verticalPadding = 10;
const maxMessageHeight = lineHeight * maxMessageLines + verticalPadding;

function createSession(title = "New chat"): ChatSession {
  const now = Date.now();

  return {
    id: `chat-${now}-${Math.random().toString(16).slice(2)}`,
    title,
    turns: [],
    createdAt: now,
    updatedAt: now,
  };
}

function getInitialSessions(): ChatSession[] {
  const fallback = [createSession("README notes"), createSession("Lesson plan"), createSession("Quick review")];

  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return fallback;

    const parsed = JSON.parse(stored) as ChatSession[];
    if (!Array.isArray(parsed) || parsed.length === 0) return fallback;

    return parsed;
  } catch {
    return fallback;
  }
}

function getInitialAttachedFiles(): AttachedFile[] {
  try {
    const saved = localStorage.getItem(attachmentStorageKey);
    if (!saved) return [];

    const parsed = JSON.parse(saved) as AttachedFile[];
    if (!Array.isArray(parsed)) return [];

    return parsed.map((item) => ({
      ...item,
      preview: typeof item.preview === "string" ? item.preview : "",
      typeLabel: typeof item.typeLabel === "string" ? item.typeLabel : "file",
      sizeLabel: typeof item.sizeLabel === "string" ? item.sizeLabel : "0 B",
      supported: Boolean(item.supported),
    }));
  } catch {
    return [];
  }
}

function getInitialAppState() {
  const sessions = getInitialSessions();

  return {
    sessions,
    activeSessionId: sessions[0].id,
  };
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
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
  const typeLabel = file.type || (file.name.toLowerCase().endsWith(".md") ? "text/markdown" : "file");
  let preview = "Preview available for TXT and Markdown files only.";

  if (supported) {
    const text = await file.text();
    preview = text.trim() ? text.trim().slice(0, 180) : "Empty text file.";
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

function App() {
  const initialStateRef = useRef(getInitialAppState());

  const [preset, setPreset] = useState<(typeof presets)[number]["id"]>("balanced");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [sessions, setSessions] = useState<ChatSession[]>(initialStateRef.current.sessions);
  const [activeSessionId, setActiveSessionId] = useState(initialStateRef.current.activeSessionId);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>(getInitialAttachedFiles());
  const [message, setMessage] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const messageRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);

  const activeSession = sessions.find((item) => item.id === activeSessionId) ?? sessions[0];
  const selectedPreset = presets.find((item) => item.id === preset) ?? presets[1];
  const canSend = message.trim().length > 0 || attachedFiles.length > 0;

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    localStorage.setItem(attachmentStorageKey, JSON.stringify(attachedFiles));
  }, [attachedFiles]);

  useEffect(() => {
    if (!sessions.some((session) => session.id === activeSessionId) && sessions[0]) {
      setActiveSessionId(sessions[0].id);
    }
  }, [activeSessionId, sessions]);

  useEffect(() => {
    function closeMenu() {
      setMenuSessionId(null);
    }

    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuSessionId(null);
        setEditingSessionId(null);
      }
    }

    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useLayoutEffect(() => {
    const textarea = messageRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, maxMessageHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxMessageHeight ? "auto" : "hidden";
  }, [message]);

  async function addFiles(files: FileList | File[]) {
    const fileArray = Array.from(files);
    if (!fileArray.length) return;

    const nextFiles = await Promise.all(fileArray.map((file) => summarizeFile(file)));
    setAttachedFiles((current) => [...current, ...nextFiles]);
  }

  function createNewChat() {
    const nextSession = createSession();

    setSessions((current) => [nextSession, ...current]);
    setActiveSessionId(nextSession.id);
    setAttachedFiles([]);
    setMessage("");
    setMenuSessionId(null);
    setEditingSessionId(null);
  }

  function startRename(sessionId: string) {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;

    setDraftTitle(session.title);
    setEditingSessionId(sessionId);
    setMenuSessionId(null);
  }

  function commitRename() {
    const nextTitle = draftTitle.trim();

    if (!editingSessionId || !nextTitle) {
      setEditingSessionId(null);
      return;
    }

    setSessions((current) =>
      current.map((item) =>
        item.id === editingSessionId ? { ...item, title: nextTitle, updatedAt: Date.now() } : item,
      ),
    );

    setEditingSessionId(null);
  }

  function duplicateSession(sessionId: string) {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;

    const now = Date.now();
    const copy: ChatSession = {
      ...session,
      id: `chat-${now}-${Math.random().toString(16).slice(2)}`,
      title: `${session.title} copy`,
      createdAt: now,
      updatedAt: now,
    };

    setSessions((current) => [copy, ...current]);
    setActiveSessionId(copy.id);
    setMenuSessionId(null);
  }

 function deleteSession(sessionId: string) {
  const nextSessions = sessions.filter((item) => item.id !== sessionId);

  if (nextSessions.length === 0) {
    const nextSession = createSession();
    setSessions([nextSession]);
    setActiveSessionId(nextSession.id);
  } else {
    setSessions(nextSessions);

    if (activeSessionId === sessionId) {
      setActiveSessionId(nextSessions[0].id);
    }
  }

  setAttachedFiles([]);
  setMessage("");
  setMenuSessionId(null);
  setEditingSessionId(null);
}

  function cyclePreset() {
    const currentIndex = presets.findIndex((option) => option.id === preset);
    const nextPreset = presets[(currentIndex + 1) % presets.length];
    setPreset(nextPreset.id);
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function removeFile(fileId: string) {
    setAttachedFiles((current) => current.filter((file) => file.id !== fileId));
  }

  const outgoingPreview = attachedFiles.length
    ? `${message.trim() || "(no prompt)"}\n\nAttached file(s): ${attachedFiles.map((file) => file.name).join(", ")}\n\n${attachedFiles
        .map((file) => `${file.name}: ${file.preview || "(no preview available)"}`)
        .join("\n\n")}`
    : message.trim();

  async function sendMessage(summarize = false) {
    const trimmedMessage = message.trim();
    if (!trimmedMessage && attachedFiles.length === 0) return;

    const filesForTurn = attachedFiles;
    const titleFromMessage = trimmedMessage.slice(0, 42);
    const content = summarize
      ? trimmedMessage
        ? `Please summarize the attached file(s) and answer: ${trimmedMessage}`
        : `Please summarize the attached file(s).`
      : trimmedMessage || `Attached ${filesForTurn.length} file(s).`;

    const userTurn: ChatTurn = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
      files: filesForTurn,
    };

    const fileSummary = filesForTurn.length
      ? `I received ${filesForTurn.length} file(s): ${filesForTurn.map((item) => item.name).join(", ")}.`
      : "No files were attached.";

    const assistantTurn: ChatTurn = {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: `Placeholder response in ${selectedPreset.label} mode. ${fileSummary} Ollama integration is the next step.`,
    };

    setSessions((current) =>
      current.map((session) => {
        if (session.id !== activeSession.id) return session;

        return {
          ...session,
          title: session.title === "New chat" && titleFromMessage ? titleFromMessage : session.title,
          turns: [...session.turns, userTurn, assistantTurn],
          updatedAt: Date.now(),
        };
      }),
    );

    setMessage("");
    setAttachedFiles([]);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendMessage();
    }
  }

  function handleDragEnter(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);
    void addFiles(event.dataTransfer.files);
  }

  return (
    <main
      className={`app-shell theme-${theme}${isDragging ? " dragging" : ""}${isSidebarOpen ? "" : " sidebar-collapsed"}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging ? (
        <div className="drag-overlay" aria-hidden="true">
          <div className="drag-overlay-panel">
            <strong>Drop file here</strong>
            <span>Release to attach your file</span>
          </div>
        </div>
      ) : null}
      <aside className={`sidebar${isSidebarOpen ? "" : " sidebar-collapsed"}`}>
        <div className="sidebar-header">
          <div className="sidebar-title-shell">
            <h2>Recent chats</h2>
            <span className="sidebar-subtitle">Pick a session or collapse for a cleaner workspace.</span>
          </div>

          <div className="sidebar-header-actions">
            <button
              type="button"
              className="sidebar-new-button"
              onClick={createNewChat}
              aria-label="Start a new chat"
            >
              +
            </button>

            <button
              type="button"
              className="sidebar-toggle-button"
              onClick={() => setIsSidebarOpen((current) => !current)}
              aria-label={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
              aria-expanded={isSidebarOpen}
            >
              <span className="sidebar-toggle-icon" aria-hidden="true">
                {isSidebarOpen ? "<" : ">"}
              </span>
            </button>
          </div>
        </div>

        <div className="history-list" role="list" aria-label="Previous chat history">
          {sessions.map((item) => (
            <div
              key={item.id}
              className={item.id === activeSession.id ? "history-item-shell active" : "history-item-shell"}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenuSessionId(item.id);
              }}
            >
              {editingSessionId === item.id ? (
                <input
                  className="history-rename-input"
                  value={draftTitle}
                  autoFocus
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setDraftTitle(event.currentTarget.value)}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitRename();
                    if (event.key === "Escape") setEditingSessionId(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="history-item"
                  onClick={() => {
                    setActiveSessionId(item.id);
                    setMenuSessionId(null);
                  }}
                  onDoubleClick={() => startRename(item.id)}
                  aria-pressed={item.id === activeSession.id}
                >
                  <span className="history-item-title">{item.title}</span>
                </button>
              )}

              <button
                type="button"
                className="history-options-button"
                aria-label={`More options for ${item.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuSessionId((current) => (current === item.id ? null : item.id));
                }}
              >
                ⋯
              </button>

              {menuSessionId === item.id ? (
  <div className="history-menu" role="menu" onMouseDown={(event) => event.stopPropagation()}>
    <button
      type="button"
      className="history-menu-item"
      onMouseDown={(event) => {
        event.preventDefault();
        startRename(item.id);
      }}
    >
      Rename
    </button>

    <button
      type="button"
      className="history-menu-item"
      onMouseDown={(event) => {
        event.preventDefault();
        duplicateSession(item.id);
      }}
    >
      Duplicate
    </button>

    <button
      type="button"
      className="history-menu-item danger"
      onMouseDown={(event) => {
        event.preventDefault();
        deleteSession(item.id);
      }}
    >
      Delete
    </button>
  </div>
) : null}
            </div>
          ))}
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            aria-pressed={theme === "light"}
          >
            {theme === "dark" ? "Light" : "Dark"}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".txt,.md,text/plain,text/markdown"
            onChange={(event) => {
              void addFiles(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
            }}
            className="file-input"
            aria-hidden="true"
            tabIndex={-1}
          />
        </header>

        {attachedFiles.length ? (
          <section className="file-preview-panel" aria-label="File preview panel">
            <div className="file-preview-header">
              <div>
                <div className="file-preview-title">File preview</div>
                <div className="file-preview-subtitle">Review the selected file and what will be sent to the model.</div>
              </div>
              <button type="button" className="clear-files-button" onClick={() => setAttachedFiles([])}>
                Clear files
              </button>
            </div>

            <div className="file-preview-status">File attached and ready. Remove or clear this file to change it.</div>

            <div className="file-preview-grid">
              {attachedFiles.map((file) => (
                <div key={file.id} className="file-preview-card">
                  <div className="file-preview-card-header">
                    <strong>{file.name}</strong>
                    <button type="button" className="remove-file-button" onClick={() => removeFile(file.id)}>
                      Remove
                    </button>
                  </div>
                  <span className="file-preview-meta">{file.typeLabel} · {file.sizeLabel}</span>
                  <div className="file-preview-text">
                    {file.supported ? file.preview : "Preview unavailable for this file type."}
                  </div>
                </div>
              ))}
            </div>

            <div className="outgoing-preview">
              <div className="preview-label">What will be sent to the model</div>
              <pre>{outgoingPreview}</pre>
            </div>
          </section>
        ) : null}

        <section className="card chat-panel chat-canvas">
          <div className="canvas-greeting">
            <h3>Hi, what can I help with today?</h3>
            <p>Drop a file anywhere in the app, pick a preset, and ask a question.</p>
          </div>

          <div className="panel-title-shell">
            <div className="panel-title">Conversation</div>
            <div className="panel-subtitle">Messages and assistant replies</div>
          </div>

          <div className="response-panel compact-response slim-response">
            <div className="response-section response-log-shell">
              <div className="response-section-title">Messages</div>
              <p className="response-note">Active chat: {activeSession.title}</p>

              <div className="response-log">
                {activeSession.turns.length ? (
                  activeSession.turns.map((turn) => (
                    <div key={turn.id} className={`turn turn-${turn.role}`}>
                      {turn.files?.length ? (
                        <div className="message-attachments">
                          {turn.files.map((file) => (
                            <div key={file.id} className="message-attachment">
                              <strong>{file.name}</strong>
                              <span>
                                {file.typeLabel} · {file.sizeLabel}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      <p>{turn.content}</p>
                    </div>
                  ))
                ) : (
                  <p className="response-empty">Your first send will create a placeholder response.</p>
                )}
              </div>
            </div>
          </div>

          <div className="composer-stack">
            {attachedFiles.length ? (
              <div className="pending-attachments" aria-label="Files ready to send">
                {attachedFiles.map((file) => (
                  <div key={file.id} className="pending-attachment">
                    <strong>{file.name}</strong>
                    <span>{file.sizeLabel}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="composer-shell" aria-label="Message composer">
              <button type="button" className="attach-button" aria-label="Attach file" onClick={openFilePicker}>
                +
              </button>

              <textarea
                ref={messageRef}
                className="prompt-box"
                placeholder="Message Desktop Spotlight AI"
                rows={1}
                value={message}
                onChange={(event) => setMessage(event.currentTarget.value)}
                onKeyDown={handleKeyDown}
              />

              <button
                type="button"
                className="preset-pill-button"
                aria-label={`Current preset ${selectedPreset.label}`}
                title={selectedPreset.description}
                onClick={cyclePreset}
              >
                {selectedPreset.label}
              </button>

              <button
                type="button"
                className="secondary-button summarize-button"
                aria-label="Summarize"
                disabled={!canSend}
                onClick={() => void sendMessage(true)}
              >
                Summarize
              </button>

              <button
                type="button"
                className="primary-button send-button"
                aria-label="Send"
                disabled={!canSend}
                onClick={() => void sendMessage()}
              >
                Send
              </button>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

export default App;