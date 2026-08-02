import type { RefObject, UIEventHandler } from "react";
import { formatLocalTime } from "../app/sessionStorage";
import type { ChatSession, ChatTurn } from "../app/types";
import {
  CopyIcon,
  DownloadIcon,
  EditIcon,
  RegenerateIcon,
} from "./icons";
import { MarkdownMessage } from "./MarkdownMessage";
import { FilesystemProposalParser } from "./FilesystemProposal";

type ConversationLogProps = {
  activeModelName: string;
  canRegenerateAssistantTurnId?: string;
  isGenerating: boolean;
  generationActivity?: string;
  responseLogRef: RefObject<HTMLDivElement | null>;
  session: ChatSession;
  streamingTextElementRef: RefObject<HTMLParagraphElement | null>;
  streamingTurnId: string | null;
  folderPath?: string;
  onFilesystemApplied: () => void;
  onCopyResponse: (content: string) => void;
  onDownloadResponse: (content: string) => void;
  onEditPrompt: (turn: ChatTurn) => void;
  onRegenerate: () => void;
  onScroll: UIEventHandler<HTMLDivElement>;
};

export function ConversationLog({
  activeModelName,
  canRegenerateAssistantTurnId,
  isGenerating,
  generationActivity,
  responseLogRef,
  session,
  streamingTextElementRef,
  streamingTurnId,
  folderPath,
  onFilesystemApplied,
  onCopyResponse,
  onDownloadResponse,
  onEditPrompt,
  onRegenerate,
  onScroll,
}: ConversationLogProps) {
  return (
    <div className="response-panel">
      {isGenerating ? (
        <div className="response-loading-banner">
          <span className="loading-indicator" aria-live="polite">
            {generationActivity || "Generating response..."}
          </span>
        </div>
      ) : null}
      <div ref={responseLogRef} className="response-log" onScroll={onScroll}>
        {session.turns.length ? (
          session.turns.map((turn, turnIndex) => {
            const isStreamingTurn = turn.id === streamingTurnId;
            const canRegenerateTurn =
              turn.role === "assistant" &&
              canRegenerateAssistantTurnId === turn.id;
            const proposalFolderPath =
              turn.role === "assistant"
                ? session.turns[turnIndex - 1]?.files?.find(
                    (file) => file.kind === "folder",
                  )?.sourcePath
                : undefined;
            const canApplyProposal =
              canRegenerateTurn &&
              Boolean(folderPath) &&
              proposalFolderPath === folderPath;

            return (
              <div key={turn.id} className={`turn-row turn-row-${turn.role}`}>
                <div
                  className={`turn turn-${turn.role}${
                    isStreamingTurn ? " streaming" : ""
                  }`}
                >
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

                  {isStreamingTurn ? (
                    <p ref={streamingTextElementRef}>{turn.content}</p>
                  ) : (
                    <>
                      <MarkdownMessage content={turn.content} />
                      {canApplyProposal && proposalFolderPath ? (
                        <FilesystemProposalParser
                          content={turn.content}
                          basePath={proposalFolderPath}
                          onApplied={onFilesystemApplied}
                        />
                      ) : null}
                    </>
                  )}

                  {turn.role === "assistant" ? (
                    <div className="turn-actions turn-actions-assistant">
                      <button
                        type="button"
                        className="turn-action-button"
                        aria-label="Copy response"
                        title="Copy response"
                        onClick={() => onCopyResponse(turn.content)}
                      >
                        <CopyIcon className="turn-action-icon" />
                      </button>
                      <button
                        type="button"
                        className="turn-action-button"
                        aria-label="Download response as Markdown"
                        title="Download response as Markdown"
                        onClick={() => onDownloadResponse(turn.content)}
                      >
                        <DownloadIcon className="turn-action-icon" />
                      </button>
                      {canRegenerateTurn ? (
                        <button
                          type="button"
                          className="turn-action-button"
                          aria-label="Regenerate response"
                          title="Regenerate response"
                          disabled={isGenerating || !activeModelName}
                          onClick={onRegenerate}
                        >
                          <RegenerateIcon className="turn-action-icon" />
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <div className="turn-actions turn-actions-user">
                      <button
                        type="button"
                        className="turn-action-button"
                        aria-label="Edit prompt"
                        title="Edit prompt"
                        disabled={isGenerating}
                        onClick={() => onEditPrompt(turn)}
                      >
                        <EditIcon className="turn-action-icon" />
                      </button>
                    </div>
                  )}
                </div>
                <time
                  className="turn-timestamp"
                  dateTime={
                    turn.createdAt
                      ? new Date(turn.createdAt).toISOString()
                      : undefined
                  }
                >
                  {formatLocalTime(turn.createdAt)}
                </time>
              </div>
            );
          })
        ) : (
          <p className="response-empty">Your first message will create a local response.</p>
        )}
      </div>
    </div>
  );
}
