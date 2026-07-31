import type { AttachedFile } from "../app/types";

export type PreviewMode = "extracted" | "sent";

type FilePreviewProps = {
  activePreviewText: string;
  attachments: AttachedFile[];
  isOpen: boolean;
  previewMode: PreviewMode;
  selectedFile: AttachedFile;
  onDetach: (fileId: string) => void;
  onOpenChange: (isOpen: boolean) => void;
  onPreviewModeChange: (mode: PreviewMode) => void;
  onSelectFile: (fileId: string) => void;
};

export function FilePreview({
  activePreviewText,
  attachments,
  isOpen,
  previewMode,
  selectedFile,
  onDetach,
  onOpenChange,
  onPreviewModeChange,
  onSelectFile,
}: FilePreviewProps) {
  return (
    <section
      className={`file-preview-panel${isOpen ? " open" : ""}`}
      aria-label="Attached file preview"
    >
      <div className="file-preview-header">
        <button
          type="button"
          className="file-preview-toggle"
          aria-expanded={isOpen}
          onClick={() => onOpenChange(!isOpen)}
        >
          <span className="file-preview-toggle-copy">
            <small>{selectedFile.name}</small>
          </span>
          <span className="file-preview-toggle-action">
            {isOpen ? "Hide preview" : "Preview"}
          </span>
        </button>
        {selectedFile.kind === "folder" ? (
          <button
            type="button"
            className="file-preview-detach"
            onClick={() => onDetach(selectedFile.id)}
          >
            Detach
          </button>
        ) : null}
      </div>

      {isOpen ? (
        <>
          {attachments.length > 1 ? (
            <div
              className="file-preview-tabs"
              role="tablist"
              aria-label="Attached files"
            >
              {attachments.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  role="tab"
                  aria-selected={file.id === selectedFile.id}
                  className={`file-preview-tab${
                    file.id === selectedFile.id ? " active" : ""
                  }`}
                  onClick={() => onSelectFile(file.id)}
                >
                  <strong>{file.name}</strong>
                  <span>{file.sizeLabel}</span>
                </button>
              ))}
            </div>
          ) : null}

          {selectedFile.folderStats ? (
            <div className="folder-scan-summary">
              <span>
                Attached folder: <strong>{selectedFile.folderStats.rootName}</strong>
              </span>
              <span>{selectedFile.folderStats.filesFound} files found</span>
              <span>{selectedFile.folderStats.filesIncluded} included</span>
              <span>{selectedFile.folderStats.filesIgnored} ignored</span>
              <span>{selectedFile.folderStats.filesSkipped} skipped</span>
            </div>
          ) : null}

          <div className="file-preview-toolbar">
            <div
              className="file-preview-mode-switch"
              role="tablist"
              aria-label="Preview mode"
            >
              <button
                type="button"
                role="tab"
                aria-selected={previewMode === "extracted"}
                className={`file-preview-mode-button${
                  previewMode === "extracted" ? " active" : ""
                }`}
                onClick={() => onPreviewModeChange("extracted")}
              >
                Extracted
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={previewMode === "sent"}
                className={`file-preview-mode-button${
                  previewMode === "sent" ? " active" : ""
                }`}
                onClick={() => onPreviewModeChange("sent")}
              >
                Sent to model
              </button>
            </div>
            <span className="file-preview-status">
              {previewMode === "sent"
                ? "Current draft plus attached file context"
                : selectedFile.kind === "folder"
                  ? "Ready for local project questions"
                  : selectedFile.supported
                    ? "Ready for local analysis"
                    : "Preview unavailable for this file type"}
            </span>
          </div>
          <pre
            className={`file-preview-text${
              previewMode === "sent" ? " prompt-preview-text" : ""
            }`}
          >
            {activePreviewText}
          </pre>
        </>
      ) : null}
    </section>
  );
}
