import { useState } from "react";
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
  const [activeHistory, setActiveHistory] = useState<(typeof chatHistory)[number]["id"]>(
    chatHistory[0].id,
  );

  const selectedHistory = chatHistory.find((item) => item.id === activeHistory) ?? chatHistory[0];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <p className="eyebrow">History</p>
          <h2>Recent chats</h2>
        </div>

        <section className="history-card compact-card">
          <div className="status-row">
            <span className="status-dot" />
            <span>Pull up previous chats</span>
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
                <span className="history-item-top">
                  <strong>{item.title}</strong>
                  <span>{item.time}</span>
                </span>
                <span className="history-snippet">{item.snippet}</span>
              </button>
            ))}
          </div>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="preset-selector" role="tablist" aria-label="Model preset selector">
            {presets.map((option) => (
              <button
                key={option.id}
                type="button"
                className={option.id === preset ? "preset-button active" : "preset-button"}
                onClick={() => setPreset(option.id)}
                aria-pressed={option.id === preset}
              >
                <span>{option.label}</span>
              </button>
            ))}
          </div>
          <div className="local-badge">
            <span className="status-dot" />
            <span>Processing stays local</span>
          </div>
        </header>

        <section className="card chat-canvas">
          <div className="canvas-greeting">
            <p className="section-label">Desktop Spotlight AI</p>
            <h3>Hi, what can I help with today?</h3>
            <p>
              Drop a file anywhere in the app, pick a preset, and ask a question. Previous chats
              stay in the sidebar.
            </p>
          </div>

          <div className="active-thread-bar">
            <span className="section-label">Active chat</span>
            <strong>{selectedHistory.title}</strong>
            <p>{selectedHistory.snippet}</p>
          </div>

          <div className="response-panel compact-response">
            <p className="response-empty">Responses from Ollama will appear here.</p>
            <p className="response-note">Loading, error, and success states will follow.</p>
          </div>

          <div className="composer-shell" aria-label="Message composer">
            <button type="button" className="attach-button" aria-label="Attach file">
              +
            </button>
            <textarea
              className="prompt-box prompt-box-chatgpt"
              placeholder="Message Desktop Spotlight AI"
              rows={2}
            />
            <button type="button" className="primary-button send-button">
              Send
            </button>
          </div>
        </section>
      </section>
    </main>
  );
}

export default App;
