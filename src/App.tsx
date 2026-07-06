import { type DragEvent, type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import "./App.css";

const presets = [
  { id: "lite", label: "Lite", description: "Fast answers for smaller files and quick summaries." },
  { id: "balanced", label: "Balanced", description: "Default mix of speed and reasoning depth." },
  { id: "pro", label: "Pro", description: "Best for longer prompts and more careful analysis." },
] as const;

const chatHistory = [
  { id: "readme-notes", title: "README notes" },
  { id: "lesson-plan", title: "Lesson plan" },
  { id: "quick-review", title: "Quick review" },
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
};

const maxMessageLines = 10;
const lineHeight = 18;
const verticalPadding = 10;
const maxMessageHeight = lineHeight * maxMessageLines + verticalPadding;

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
  const [preset, setPreset] = useState<(typeof presets)[number]["id"]>("balanced");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [activeHistory, setActiveHistory] = useState<(typeof chatHistory)[number]["id"]>(chatHistory[0].id);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [message, setMessage] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const messageRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);

  const selectedHistory = chatHistory.find((item) => item.id === activeHistory) ?? chatHistory[0];
  const selectedPreset = presets.find((item) => item.id === preset) ?? presets[1];
  const canSend = message.trim().length > 0 || attachedFiles.length > 0;

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

  function cyclePreset() {
    const currentIndex = presets.findIndex((option) => option.id === preset);
    const nextPreset = presets[(currentIndex + 1) % presets.length];
    setPreset(nextPreset.id);
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  async function sendMessage() {
    const trimmedMessage = message.trim();
    if (!trimmedMessage && attachedFiles.length === 0) return;

    const userTurn: ChatTurn = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmedMessage || `Attached ${attachedFiles.length} file(s).`,
    };

    const fileSummary = attachedFiles.length
      ? `I received ${attachedFiles.length} file(s): ${attachedFiles.map((item) => item.name).join(", ")}.`
      : "No files were attached.";

    const assistantTurn: ChatTurn = {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: `Placeholder response in ${selectedPreset.label} mode. ${fileSummary} Ollama integration is the next step.`,
    };

    setTurns((current) => [...current, userTurn, assistantTurn]);
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
      className={`app-shell theme-${theme}${isDragging ? " dragging" : ""}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>Recent chats</h2>
        </div>

        <div className="history-list" role="list" aria-label="Previous chat history">
          {chatHistory.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === activeHistory ? "history-item active" : "history-item"}
              onClick={() => setActiveHistory(item.id)}
              aria-pressed={item.id === activeHistory}
            >
              <span className="history-item-title">{item.title}</span>
            </button>
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

        <section className="card chat-canvas">
          <div className="canvas-greeting">
            <h3>Hi, what can I help with today?</h3>
            <p>Drop a file anywhere in the app, pick a preset, and ask a question.</p>
          </div>

          <div className="response-panel compact-response slim-response">
            <div className="response-section">
              <div className="response-section-title">Attached files</div>

              {attachedFiles.length ? (
                <div className="attachment-list">
                  {attachedFiles.map((item) => (
                    <div key={item.id} className="attachment-item">
                      <strong>{item.name}</strong>
                      <span>
                        {item.typeLabel} · {item.sizeLabel}
                      </span>
                      <p>{item.preview}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="response-note">Choose or drop TXT/Markdown files anywhere in the app.</p>
              )}
            </div>

            <div className="response-section response-log-shell">
              <div className="response-section-title">Messages</div>
              <p className="response-note">Active chat: {selectedHistory.title}</p>

              <div className="response-log">
                {turns.length ? (
                  turns.map((turn) => (
                    <div key={turn.id} className={`turn turn-${turn.role}`}>
                      <p>{turn.content}</p>
                    </div>
                  ))
                ) : (
                  <p className="response-empty">Your first send will create a placeholder Ollama response.</p>
                )}
              </div>
            </div>
          </div>

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
              className="primary-button send-button"
              aria-label="Send"
              disabled={!canSend}
              onClick={() => void sendMessage()}
            >
              <span>➤</span>
            </button>
          </div>
        </section>
      </section>
    </main>
  );
}

export default App;