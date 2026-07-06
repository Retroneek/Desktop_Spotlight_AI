import { useLayoutEffect, useRef, useState } from "react";
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

const chatHistory = [
  {
    id: "readme-notes",
    title: "README notes",
    time: "2 min ago",
    snippet: "Summarize the project setup and list the MVP features.",
  },
  {
    id: "lesson-plan",
    title: "Lesson plan",
    time: "Earlier today",
    snippet: "Compare the Markdown outline against the exported notes.",
  },
  {
    id: "quick-review",
    title: "Quick review",
    time: "Yesterday",
    snippet: "Check if the file contains an overview, constraints, and next steps.",
  },
] as const;

function App() {
  const [preset, setPreset] = useState<(typeof presets)[number]["id"]>("balanced");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [activeHistory, setActiveHistory] = useState<(typeof chatHistory)[number]["id"]>(
    chatHistory[0].id,
  );
  const [message, setMessage] = useState("");
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const maxMessageLines = 10;
  const lineHeight = 18;
  const verticalPadding = 10;
  const maxMessageHeight = lineHeight * maxMessageLines + verticalPadding;

  const selectedHistory = chatHistory.find((item) => item.id === activeHistory) ?? chatHistory[0];

  useLayoutEffect(() => {
    const textarea = messageRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, maxMessageHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxMessageHeight ? "auto" : "hidden";
  }, [message, maxMessageHeight]);

  return (
    <main className={`app-shell theme-${theme}`}>
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
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-pressed={theme === "light"}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        </header>

        <section className="card chat-canvas">
          <div className="canvas-greeting">
            <h3>Hi, what can I help with today?</h3>
            <p>Drop a file anywhere in the app, pick a preset, and ask a question.</p>
          </div>

          <div className="response-panel compact-response slim-response">
            <p className="response-empty">{selectedHistory.title}</p>
            <p className="response-note">Responses from Ollama will appear here.</p>
          </div>

          <div className="composer-shell" aria-label="Message composer">
            <button type="button" className="attach-button" aria-label="Attach file">
              +
            </button>
            <textarea
              ref={messageRef}
              className="prompt-box"
              placeholder="Message Desktop Spotlight AI"
              rows={1}
              value={message}
              onChange={(event) => setMessage(event.currentTarget.value)}
            />
            <button
              type="button"
              className="preset-pill-button"
              aria-label={`Current preset ${preset}`}
              onClick={() => {
                const currentIndex = presets.findIndex((option) => option.id === preset);
                const nextPreset = presets[(currentIndex + 1) % presets.length];
                setPreset(nextPreset.id);
              }}
            >
              {presets.find((option) => option.id === preset)?.label}
            </button>
            <button type="button" className="primary-button send-button" aria-label="Send">
              <span>➤</span>
            </button>
          </div>
        </section>
      </section>
    </main>
  );
}

export default App;
