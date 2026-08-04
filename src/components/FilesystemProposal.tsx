import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  FilesystemAction,
  FilesystemProposal,
  OrganizationPlan,
  OrganizationPreview,
} from "../app/types";
import {
  containsSpotlightCommandBlock,
  executeOrganizationPlan,
  executeFilesystemOperations,
  parseOrganizationPlanFromContent,
  parseProposedActionsFromContent,
  previewOrganizationPlan,
  undoFilesystemOperation,
  writeProjectFile,
} from "../services/filesystemOps";

type FilesystemProposalProps = {
  basePath: string;
  proposal: FilesystemProposal;
  onApproved?: (proposal: FilesystemProposal) => void;
  onRejected?: () => void;
};

function getActionLabel(action: FilesystemAction) {
  switch (action.type) {
    case "move":
      return `Move “${action.from}” to “${action.to}”`;
    case "rename":
      return `Rename “${action.path}” to “${action.newName}”`;
    case "createFolder":
      return `Create folder “${action.path}”`;
    case "delete":
      return `Delete “${action.path}”`;
    case "copy":
      return `Copy “${action.from}” to “${action.to}”`;    case "write": {
      const lines = action.content.split("\n").length;
      return `Write "${action.path}" (${lines} line${lines === 1 ? "" : "s"})`;
    }  }
}

function isContradictoryOrganizationReasoning(
  reasoning: string,
  plan: OrganizationPlan,
) {
  const claimsFolderCleanup =
    /\b(?:delete|deletes|deleted|deleting|remove|removes|removed|removing)\b/i.test(
      reasoning,
    ) && /\b(?:folder|folders|director(?:y|ies))\b/i.test(reasoning);
  const claimsFlattening =
    /\b(?:flatten|main folder|root folder|top level|back into the selected folder)\b/i.test(
      reasoning,
    );

  return (
    (claimsFolderCleanup && !plan.removeEmptyFolders) ||
    (claimsFlattening && plan.groupBy[0] !== "root")
  );
}

const organizationPresets = [
  {
    key: "fileType-alphabet",
    label: "File type, then alphabet",
    groupBy: ["fileType", "alphabet"],
  },
  {
    key: "alphabet-fileType",
    label: "Alphabet, then file type",
    groupBy: ["alphabet", "fileType"],
  },
  { key: "fileType", label: "File type only", groupBy: ["fileType"] },
  { key: "alphabet", label: "Alphabet only", groupBy: ["alphabet"] },
  { key: "root", label: "Move files to the main folder", groupBy: ["root"] },
] as const;

function organizationPresetKey(plan: OrganizationPlan) {
  return plan.groupBy.join("-");
}

export function FilesystemProposalCard({
  basePath,
  proposal,
  onApproved,
  onRejected,
}: FilesystemProposalProps) {
  const [isReviewed, setIsReviewed] = useState(proposal.approved);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [appliedAt, setAppliedAt] = useState(proposal.appliedAt);
  const [resultMessage, setResultMessage] = useState("");
  const [error, setError] = useState("");
  const [backupPath, setBackupPath] = useState<string | undefined>(undefined);
  const [isUndoing, setIsUndoing] = useState(false);
  const [undoMessage, setUndoMessage] = useState("");

  useEffect(() => {
    setIsReviewed(proposal.approved);
    setIsExecuting(false);
    setIsDismissed(false);
    setAppliedAt(proposal.appliedAt);
    setResultMessage("");
    setError("");
    setBackupPath(undefined);
    setIsUndoing(false);
    setUndoMessage("");
  }, [basePath, proposal.approved, proposal.appliedAt, proposal.id]);

  const applyChanges = useCallback(async () => {
    if (!isReviewed || isExecuting || appliedAt) return;

    setIsExecuting(true);
    setError("");

    try {
      // Separate write actions from filesystem actions
      const writeActions = proposal.actions.filter((a) => a.type === "write") as Array<{ type: "write"; path: string; content: string }>;
      const otherActions = proposal.actions.filter((a) => a.type !== "write");

      // Apply write actions
      for (const action of writeActions) {
        const wr = await writeProjectFile(basePath, action.path, action.content);
        if (!wr.success) {
          setError(wr.message || "A file could not be written.");
          return;
        }
      }

      // Apply filesystem actions with backup
      if (otherActions.length > 0) {
        const result = await executeFilesystemOperations(basePath, otherActions, true);
        if (!result.success) {
          setError(result.message || "The changes could not be applied.");
          return;
        }
        if (result.backupPath) {
          setBackupPath(result.backupPath);
        }
        setResultMessage(result.message);
      } else if (writeActions.length > 0) {
        setResultMessage(`Wrote ${writeActions.length} file${writeActions.length === 1 ? "" : "s"}.`);
      }

      const completedAt = Date.now();
      setAppliedAt(completedAt);
      onApproved?.({
        ...proposal,
        approved: true,
        appliedAt: completedAt,
      });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError || "The changes could not be applied."),
      );
    } finally {
      setIsExecuting(false);
    }
  }, [appliedAt, basePath, isExecuting, isReviewed, onApproved, proposal]);

  const undoChanges = useCallback(async () => {
    if (!backupPath || isUndoing) return;
    setIsUndoing(true);
    setError("");
    try {
      const result = await undoFilesystemOperation(basePath, backupPath);
      setUndoMessage(result.message || "Changes undone.");
      setBackupPath(undefined);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Could not undo changes.",
      );
    } finally {
      setIsUndoing(false);
    }
  }, [backupPath, basePath, isUndoing]);

  const dismiss = useCallback(() => {
    setIsDismissed(true);
    onRejected?.();
  }, [onRejected]);

  if (isDismissed) return null;

  return (
    <section className="filesystem-proposal" aria-labelledby={`${proposal.id}-title`}>
      <div className="filesystem-proposal-heading">
        <div>
          <span className="filesystem-proposal-eyebrow">Review required</span>
          <h3 id={`${proposal.id}-title`}>Proposed file changes</h3>
        </div>
        <span className="filesystem-proposal-count">
          {proposal.actions.length} {proposal.actions.length === 1 ? "change" : "changes"}
        </span>
      </div>

      {proposal.reasoning ? (
        <p className="filesystem-proposal-reasoning">{proposal.reasoning}</p>
      ) : null}

      <ol className="filesystem-action-list">
        {proposal.actions.map((action, index) => (
          <li
            key={`${action.type}-${index}-${getActionLabel(action)}`}
            className={`filesystem-action filesystem-action-${action.type}`}
          >
            <span className="filesystem-action-number">{index + 1}</span>
            <span>{getActionLabel(action)}</span>
          </li>
        ))}
      </ol>

      {error ? <p className="filesystem-proposal-status is-error">{error}</p> : null}
      {undoMessage ? <p className="filesystem-proposal-status is-success">{undoMessage}</p> : null}
      {appliedAt ? (
        <div className="filesystem-proposal-applied">
          <p className="filesystem-proposal-status is-success">
            {resultMessage || "Changes applied."} Completed at{" "}
            {new Date(appliedAt).toLocaleTimeString()}.
          </p>
          {backupPath ? (
            <button
              type="button"
              className="filesystem-undo-button"
              disabled={isUndoing}
              onClick={() => void undoChanges()}
            >
              {isUndoing ? "Undoing…" : "Undo deletions"}
            </button>
          ) : null}
        </div>
      ) : null}

      {!appliedAt ? (
        <>
          <label className="filesystem-review-check">
            <input
              type="checkbox"
              checked={isReviewed}
              disabled={isExecuting}
              onChange={(event) => setIsReviewed(event.target.checked)}
            />
            <span>I reviewed each change for the selected folder.</span>
          </label>
          <div className="filesystem-proposal-actions">
            <button
              type="button"
              className="filesystem-apply-button"
              disabled={!isReviewed || isExecuting}
              onClick={() => void applyChanges()}
            >
              {isExecuting ? "Applying…" : "Apply changes"}
            </button>
            <button
              type="button"
              className="filesystem-dismiss-button"
              disabled={isExecuting}
              onClick={dismiss}
            >
              Dismiss
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}

function OrganizationProposalCard({
  basePath,
  plan,
  onApplied,
}: {
  basePath: string;
  plan: OrganizationPlan;
  onApplied?: () => void;
}) {
  const [editedPlan, setEditedPlan] = useState(plan);
  const [preview, setPreview] = useState<OrganizationPreview | null>(null);
  const [isReviewed, setIsReviewed] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [resultMessage, setResultMessage] = useState("");
  const [error, setError] = useState("");
  const [previewRevision, setPreviewRevision] = useState(0);

  useEffect(() => {
    setEditedPlan(plan);
  }, [basePath, plan]);

  useEffect(() => {
    let active = true;
    setPreview(null);
    setIsReviewed(false);
    setIsExecuting(false);
    setIsDismissed(false);
    setResultMessage("");
    setError("");
    void previewOrganizationPlan(basePath, editedPlan)
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch((caughtError) => {
        if (active) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : String(caughtError || "The organization preview could not be created."),
          );
        }
      });
    return () => {
      active = false;
    };
  }, [basePath, editedPlan, previewRevision]);

  const hasReviewableChanges = Boolean(
    preview && (preview.plannedMoves > 0 || preview.plannedFolderRemovals > 0),
  );

  const applyPlan = useCallback(async () => {
    if (
      !preview ||
      !isReviewed ||
      isExecuting ||
      !hasReviewableChanges ||
      resultMessage
    ) return;
    setIsExecuting(true);
    setError("");
    try {
      const result = await executeOrganizationPlan(
        basePath,
        editedPlan,
        preview.fingerprint,
      );
      if (!result.success) {
        setError(result.message || "The organization plan could not be applied.");
        return;
      }
      setResultMessage(result.message);
      onApplied?.();
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError || "The organization plan could not be applied.");
      setError(message);
      if (/folder changed after the preview/i.test(message)) {
        setIsReviewed(false);
        setPreviewRevision((current) => current + 1);
      }
    } finally {
      setIsExecuting(false);
    }
  }, [basePath, editedPlan, hasReviewableChanges, isExecuting, isReviewed, onApplied, preview, resultMessage]);

  if (isDismissed) return null;

  return (
    <section className="filesystem-proposal">
      <div className="filesystem-proposal-heading">
        <div>
          <span className="filesystem-proposal-eyebrow">Command review</span>
          <h3>Organize the complete folder</h3>
        </div>
        <span className="filesystem-proposal-count">
          {preview
            ? `${preview.plannedMoves} moves${preview.plannedFolderRemovals ? ` + ${preview.plannedFolderRemovals} empty folders` : ""}`
            : "Scanning..."}
        </span>
      </div>

      {editedPlan.reasoning &&
      !isContradictoryOrganizationReasoning(editedPlan.reasoning, editedPlan) ? (
        <p className="filesystem-proposal-reasoning">{editedPlan.reasoning}</p>
      ) : null}
      <div className="filesystem-plan-editor">
        <label>
          <span>Organization</span>
          <select
            value={organizationPresetKey(editedPlan)}
            disabled={isExecuting}
            onChange={(event) => {
              const preset = organizationPresets.find(
                (candidate) => candidate.key === event.currentTarget.value,
              );
              if (!preset) return;
              setEditedPlan((current) => ({
                ...current,
                groupBy: [...preset.groupBy],
                reasoning: "",
              }));
            }}
          >
            {organizationPresets.map((preset) => (
              <option key={preset.key} value={preset.key}>{preset.label}</option>
            ))}
          </select>
        </label>
        <label className="filesystem-plan-cleanup">
          <input
            type="checkbox"
            checked={editedPlan.removeEmptyFolders}
            disabled={isExecuting}
            onChange={(event) => {
              const removeEmptyFolders = event.currentTarget.checked;
              setEditedPlan((current) => ({
                ...current,
                removeEmptyFolders,
                reasoning: "",
              }));
            }}
          />
          <span>Remove folders only after they are empty</span>
        </label>
      </div>
      <p className="filesystem-proposal-reasoning">
        {editedPlan.groupBy[0] === "root"
          ? "Destination: the selected folder's main level."
          : `Hierarchy: ${editedPlan.groupBy.join(" then ")}.`} The app expands this
        command locally; filenames are not returned as a giant model-generated
        action list. {editedPlan.removeEmptyFolders
          ? "Cleanup can remove only directories that are empty after the moves."
          : "Existing folders are left untouched."}
      </p>

      {preview ? (
        <>
          <div className="filesystem-plan-stats">
            <span>{preview.totalFiles} files scanned</span>
            <span>{preview.unchangedFiles} already organized</span>
            <span>{preview.batchCount} execution batches</span>
            {preview.plannedFolderRemovals ? (
              <span>{preview.plannedFolderRemovals} empty folders to remove</span>
            ) : null}
            {preview.conflicts ? <span>{preview.conflicts} conflicts skipped</span> : null}
            {Object.entries(preview.typeBreakdown).map(([fileType, count]) => (
              <span key={fileType}>{fileType}: {count}</span>
            ))}
          </div>
          <ol className="filesystem-action-list">
            {preview.sampleActions.map((action, index) => (
              <li
                key={`${action.type}-${index}-${getActionLabel(action)}`}
                className={`filesystem-action filesystem-action-${action.type}`}
              >
                <span className="filesystem-action-number">{index + 1}</span>
                <span>{getActionLabel(action)}</span>
              </li>
            ))}
          </ol>
          {preview.plannedMoves > preview.sampleActions.length ? (
            <p className="filesystem-proposal-reasoning">
              Showing {preview.sampleActions.length} examples. The same reviewed rule
              covers {preview.plannedMoves} moves.
            </p>
          ) : null}
        </>
      ) : null}

      {error ? <p className="filesystem-proposal-status is-error">{error}</p> : null}
      {error && !preview ? (
        <button
          type="button"
          className="filesystem-dismiss-button"
          disabled={isExecuting}
          onClick={() => setPreviewRevision((current) => current + 1)}
        >
          Retry preview
        </button>
      ) : null}
      {preview?.conflicts ? (
        <p className="filesystem-proposal-status">
          {preview.conflicts} conflicting {preview.conflicts === 1 ? "file" : "files"}
          {" will be left where they are. The other moves are safe to apply."}
        </p>
      ) : null}
      {preview && !hasReviewableChanges && !preview.conflicts ? (
        <p className="filesystem-proposal-status">
          No files or empty folders need changes for this plan.
        </p>
      ) : null}
      {resultMessage ? (
        <p className="filesystem-proposal-status is-success">{resultMessage}</p>
      ) : null}

      {preview && !resultMessage ? (
        <>
          <label className="filesystem-review-check">
            <input
              type="checkbox"
              checked={isReviewed}
              disabled={isExecuting || !hasReviewableChanges}
              onChange={(event) => setIsReviewed(event.target.checked)}
            />
            <span>I reviewed the destinations, conflicts, folder cleanup, and sample moves.</span>
          </label>
          <div className="filesystem-proposal-actions">
            <button
              type="button"
              className="filesystem-apply-button"
              disabled={
                !isReviewed ||
                isExecuting ||
                !hasReviewableChanges
              }
              onClick={() => void applyPlan()}
            >
              {isExecuting ? "Applying batches..." : "Apply organization plan"}
            </button>
            <button
              type="button"
              className="filesystem-dismiss-button"
              disabled={isExecuting}
              onClick={() => setIsDismissed(true)}
            >
              Dismiss
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}

type ProposalParserProps = {
  content: string;
  basePath: string;
  onApplied?: () => void;
};

export function FilesystemProposalParser({
  content,
  basePath,
  onApplied,
}: ProposalParserProps) {
  const proposal = useMemo(
    () => parseProposedActionsFromContent(content),
    [content],
  );
  const organizationPlan = useMemo(
    () => parseOrganizationPlanFromContent(content),
    [content],
  );
  const hasCommandBlock = useMemo(
    () => containsSpotlightCommandBlock(content),
    [content],
  );

  if (organizationPlan) {
    return (
      <OrganizationProposalCard
        basePath={basePath}
        plan={organizationPlan}
        onApplied={onApplied}
      />
    );
  }

  if (!proposal && hasCommandBlock) {
    return (
      <section className="filesystem-proposal">
        <div className="filesystem-proposal-heading">
          <div>
            <span className="filesystem-proposal-eyebrow">Command review</span>
            <h3>Plan needs correction</h3>
          </div>
        </div>
        <p className="filesystem-proposal-status is-error">
          The command block was not recognized, so no file action can be confirmed
          or executed. Regenerate the response to create a fresh plan.
        </p>
      </section>
    );
  }

  return proposal ? (
    <FilesystemProposalCard
      basePath={basePath}
      proposal={proposal}
      onApproved={onApplied}
    />
  ) : null;
}
