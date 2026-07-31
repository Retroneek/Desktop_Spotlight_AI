import type { KeyboardEvent, RefObject } from "react";
import type { AttachedFile } from "../app/types";
import { AttachIcon, SendIcon } from "./icons";

type MessageComposerProps = {
  attachedFiles: AttachedFile[];
  canSend: boolean;
  isExpanded: boolean;
  isGenerating: boolean;
  message: string;
  messageRef: RefObject<HTMLTextAreaElement | null>;
  onAttach: () => void;
  onAttachFolder: () => void;
  onCancel: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onMessageChange: (value: string) => void;
  onRemoveFile: (fileId: string) => void;
  onSend: () => void;
};

export function MessageComposer({
  attachedFiles,
  canSend,
  isExpanded,
  isGenerating,
  message,
  messageRef,
  onAttach,
  onAttachFolder,
  onCancel,
  onKeyDown,
  onMessageChange,
  onRemoveFile,
  onSend,
}: MessageComposerProps) {
  return (
    <div className="composer-stack">
      {attachedFiles.length ? (
        <div className="pending-attachments" aria-label="Files ready to send">
          {attachedFiles.map((file) => (
            <div key={file.id} className="pending-attachment">
              <div className="pending-file-details">
                <strong>{file.name}</strong>
                <span>
                  {file.folderStats
                    ? `${file.folderStats.filesIncluded} included · stays attached`
                    : file.sizeLabel}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onRemoveFile(file.id)}
                aria-label={`Remove ${file.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div
        className={`composer-shell${isExpanded ? " expanded" : ""}${
          isGenerating ? " generating" : ""
        }`}
        aria-label="Message composer"
      >
        <button
          type="button"
          className="attach-button"
          aria-label="Attach file"
          disabled={isGenerating}
          onClick={onAttach}
        >
          <AttachIcon className="ui-icon" />
        </button>
        <button
          type="button"
          className="attach-folder-button"
          aria-label="Attach folder"
          disabled={isGenerating}
          onClick={onAttachFolder}
        >
          Folder
        </button>
        <textarea
          ref={messageRef}
          className="prompt-box"
          placeholder="Ask anything or drop in a file"
          rows={1}
          value={message}
          disabled={isGenerating}
          onChange={(event) => onMessageChange(event.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
        {isGenerating ? (
          <button
            type="button"
            className="cancel-button composer-cancel-button"
            onClick={onCancel}
          >
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          className="send-button"
          aria-label="Send"
          disabled={!canSend}
          onClick={onSend}
        >
          <SendIcon className="ui-icon" />
          <span>{isGenerating ? "Working" : "Send"}</span>
        </button>
      </div>

      <p className="composer-hint">
        <kbd>Enter</kbd> to send <span>·</span> <kbd>Shift + Enter</kbd> for a
        new line
      </p>
    </div>
  );
}
