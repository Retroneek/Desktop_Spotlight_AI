import type { ChatSession, HistoryMenuState } from "../app/types";
import {
  CollapseIcon,
  MoreIcon,
  NewChatIcon,
  SettingsIcon,
} from "./icons";

type HistorySection = {
  label: string;
  sessions: ChatSession[];
};

type SidebarProps = {
  activeSessionId: string;
  collapsedPreviewSessions: ChatSession[];
  draftTitle: string;
  editingSessionId: string | null;
  historyMenu: HistoryMenuState | null;
  historySections: HistorySection[];
  isCollapsed: boolean;
  isSettingsOpen: boolean;
  onCancelRename: () => void;
  onCollapseChange: (isCollapsed: boolean) => void;
  onCommitRename: () => void;
  onCreateChat: () => void;
  onDeleteSession: (sessionId: string) => void;
  onDraftTitleChange: (title: string) => void;
  onDuplicateSession: (sessionId: string) => void;
  onOpenHistoryMenu: (sessionId: string, x: number, y: number) => void;
  onSelectSession: (sessionId: string) => void;
  onStartRename: (sessionId: string) => void;
  onToggleSettings: () => void;
};

export function Sidebar({
  activeSessionId,
  collapsedPreviewSessions,
  draftTitle,
  editingSessionId,
  historyMenu,
  historySections,
  isCollapsed,
  isSettingsOpen,
  onCancelRename,
  onCollapseChange,
  onCommitRename,
  onCreateChat,
  onDeleteSession,
  onDraftTitleChange,
  onDuplicateSession,
  onOpenHistoryMenu,
  onSelectSession,
  onStartRename,
  onToggleSettings,
}: SidebarProps) {
  return (
    <>
      <aside className={`sidebar${isCollapsed ? " collapsed" : ""}`}>
        <div className="sidebar-header">
          <div className="product-brand" aria-label="Spotlight Local AI">
            <span className="product-mark" aria-hidden="true">
              ✦
            </span>
            <span className="product-name">Spotlight</span>
            <small>Local AI</small>
          </div>
          <div className="sidebar-header-bar">
            <button
              type="button"
              className="sidebar-collapse-button"
              onClick={() => onCollapseChange(!isCollapsed)}
              aria-pressed={isCollapsed}
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <CollapseIcon
                className={`ui-icon${isCollapsed ? " is-collapsed" : ""}`}
              />
            </button>
            <button
              type="button"
              className="sidebar-new-button"
              onClick={onCreateChat}
              aria-label="Create new chat"
            >
              <NewChatIcon className="ui-icon" />
            </button>
          </div>
          <h2>Recent chats</h2>
          {collapsedPreviewSessions.length ? (
            <div className="sidebar-collapsed-list" aria-hidden={!isCollapsed}>
              {collapsedPreviewSessions.map((session, index) => (
                <button
                  key={session.id}
                  type="button"
                  className={`sidebar-collapsed-item${
                    session.id === activeSessionId ? " active" : ""
                  }`}
                  onClick={() => onSelectSession(session.id)}
                  aria-label={`Open recent chat ${index + 1}`}
                >
                  <span aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div
          className="history-list"
          role="list"
          aria-label="Previous chat history"
        >
          {historySections.map((section) => (
            <section key={section.label} className="history-group">
              <h3 className="history-group-label">{section.label}</h3>
              <div className="history-group-items">
                {section.sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`history-item-shell${
                      session.id === activeSessionId ? " active" : ""
                    }`}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      onOpenHistoryMenu(
                        session.id,
                        event.clientX,
                        event.clientY,
                      );
                    }}
                  >
                    {editingSessionId === session.id &&
                    session.id !== activeSessionId ? (
                      <input
                        className="history-rename-input"
                        value={draftTitle}
                        autoFocus
                        onPointerDown={(event) => event.stopPropagation()}
                        onChange={(event) =>
                          onDraftTitleChange(event.currentTarget.value)
                        }
                        onBlur={onCommitRename}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                          if (event.key === "Escape") onCancelRename();
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="history-item"
                        onClick={() => onSelectSession(session.id)}
                        onDoubleClick={() => onStartRename(session.id)}
                        aria-pressed={session.id === activeSessionId}
                      >
                        <span className="history-item-title">{session.title}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="history-options-button"
                      aria-label={`More options for ${session.title}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        const rect = event.currentTarget.getBoundingClientRect();
                        onOpenHistoryMenu(
                          session.id,
                          rect.right - 164,
                          rect.bottom + 6,
                        );
                      }}
                    >
                      <MoreIcon className="ui-icon" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="sidebar-footer">
          <button
            type="button"
            className="sidebar-settings-button"
            aria-pressed={isSettingsOpen}
            aria-label={isSettingsOpen ? "Open chat" : "Open settings"}
            onClick={onToggleSettings}
          >
            <SettingsIcon className="ui-icon" />
            <span>{isSettingsOpen ? "Back to chat" : "Settings"}</span>
          </button>
        </div>
      </aside>

      {historyMenu ? (
        <div
          className="history-menu"
          style={{ left: historyMenu.x, top: historyMenu.y }}
          role="menu"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="history-menu-item"
            onClick={() => onStartRename(historyMenu.sessionId)}
          >
            Rename
          </button>
          <button
            type="button"
            className="history-menu-item"
            onClick={() => onDuplicateSession(historyMenu.sessionId)}
          >
            Duplicate
          </button>
          <button
            type="button"
            className="history-menu-item danger"
            onClick={() => onDeleteSession(historyMenu.sessionId)}
          >
            Delete
          </button>
        </div>
      ) : null}
    </>
  );
}
