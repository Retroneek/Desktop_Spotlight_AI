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
  listenForOrganizationProgress,
  parseOrganizationPlanFromContent,
  parseProposedActionsFromContent,
  previewOrganizationPlan,
} from "../services/filesystemOps";
import type { OrganizationProgress } from "../services/filesystemOps";

type FilesystemProposalProps = {
  basePath: string;
  proposal: FilesystemProposal;
  onApproved?: (proposal: FilesystemProposal) => void | Promise<void>;
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
      return `Copy “${action.from}” to “${action.to}”`;
  }
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

function organizationLabel(plan: OrganizationPlan) {
  return plan.groupBy
    .map((group) => {
      switch (group) {
        case "fileType":
          return "exact file type";
        case "category":
          return "broad category";
        case "alphabet":
          return "alphabet";
        case "root":
          return "the main folder";
      }
    })
    .join(" then ");
}

function explicitlyRequestsFolderRemoval(content: string) {
  if (
    /\b(?:(?:do not|don't|dont)\s+(?:delete|remove)|without\s+(?:deleting|removing)|(?:keep|leave)\s+(?:the\s+)?)\b[^.!?]{0,35}\b(?:folders?|director(?:y|ies))\b/i.test(
      content,
    )
  ) {
    return false;
  }

  return /\b(?:delete|remove|clean up)\b[^.!?]{0,60}\b(?:empty\s+)?(?:subfolders?|folders?|director(?:y|ies))\b/i.test(
    content,
  );
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

  useEffect(() => {
    setIsReviewed(proposal.approved);
    setIsExecuting(false);
    setIsDismissed(false);
    setAppliedAt(proposal.appliedAt);
    setResultMessage("");
    setError("");
  }, [basePath, proposal.approved, proposal.appliedAt, proposal.id]);

  const applyChanges = useCallback(async () => {
    if (!isReviewed || isExecuting || appliedAt) return;

    setIsExecuting(true);
    setError("");

    try {
      const result = await executeFilesystemOperations(basePath, proposal.actions);
      if (!result.success) {
        setError(result.message || "The changes could not be applied.");
        return;
      }

      const completedAt = Date.now();
      setAppliedAt(completedAt);
      setResultMessage(result.message);
      try {
        await onApproved?.({
          ...proposal,
          approved: true,
          appliedAt: completedAt,
        });
      } catch (refreshError) {
        const detail =
          refreshError instanceof Error ? refreshError.message : String(refreshError);
        setError(
          `The changes were applied, but the folder inventory could not be refreshed${
            detail ? `: ${detail}` : "."
          }`,
        );
      }
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
      {appliedAt ? (
        <p className="filesystem-proposal-status is-success">
          {resultMessage || "Changes applied."} Completed at{" "}
          {new Date(appliedAt).toLocaleTimeString()}.
        </p>
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
  onApplied?: () => void | Promise<void>;
}) {
  const [preview, setPreview] = useState<OrganizationPreview | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [resultMessage, setResultMessage] = useState("");
  const [error, setError] = useState("");
  const [previewRevision, setPreviewRevision] = useState(0);
  const [executionProgress, setExecutionProgress] = useState<OrganizationProgress | null>(null);

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;
    const comparableBasePath = basePath.replace(/\\/g, "/").toLocaleLowerCase();
    void listenForOrganizationProgress((progress) => {
      if (
        progress.basePath.replace(/\\/g, "/").toLocaleLowerCase() === comparableBasePath
      ) {
        setExecutionProgress(progress);
      }
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stopListening = unlisten;
    });
    return () => {
      disposed = true;
      stopListening?.();
    };
  }, [basePath]);

  useEffect(() => {
    let active = true;
    setPreview(null);
    setIsExecuting(false);
    setIsDismissed(false);
    setResultMessage("");
    setError("");
    setExecutionProgress(null);
    void previewOrganizationPlan(basePath, plan)
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
  }, [basePath, plan, previewRevision]);

  const hasReviewableChanges = Boolean(
    preview && (preview.plannedMoves > 0 || preview.plannedFolderRemovals > 0),
  );

  const applyPlan = useCallback(async () => {
    if (
      !preview ||
      isExecuting ||
      !hasReviewableChanges ||
      resultMessage
    ) return;
    setIsExecuting(true);
    setError("");
    setExecutionProgress({
      basePath,
      phase: "moving",
      processed: 0,
      total: preview.plannedMoves,
      moved: 0,
      failed: 0,
    });
    try {
      const result = await executeOrganizationPlan(
        basePath,
        plan,
        preview.fingerprint,
      );
      if (!result.success) {
        setError(result.message || "The organization plan could not be applied.");
        return;
      }
      setResultMessage(result.message);
      setExecutionProgress(null);
      try {
        await onApplied?.();
      } catch (refreshError) {
        const detail =
          refreshError instanceof Error ? refreshError.message : String(refreshError);
        setError(
          `The organization finished, but the folder inventory could not be refreshed${
            detail ? `: ${detail}` : "."
          }`,
        );
      }
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError || "The organization plan could not be applied.");
      setError(message);
    } finally {
      setIsExecuting(false);
    }
  }, [basePath, hasReviewableChanges, isExecuting, onApplied, plan, preview, resultMessage]);

  if (isDismissed) return null;

  if (resultMessage) {
    return (
      <section className="filesystem-proposal filesystem-proposal-complete">
        <span className="filesystem-complete-mark" aria-hidden="true">&check;</span>
        <div>
          <strong>Folder updated</strong>
          <p>{resultMessage}</p>
          {error ? <p className="filesystem-proposal-status is-error">{error}</p> : null}
        </div>
      </section>
    );
  }

  return (
    <section className="filesystem-proposal">
      <div className="filesystem-proposal-heading">
        <div>
          <span className="filesystem-proposal-eyebrow">Ready for review</span>
          <h3>Organize this folder</h3>
        </div>
        <span className="filesystem-proposal-count">
          {preview
            ? `${preview.plannedMoves} moves${preview.plannedFolderRemovals ? ` + ${preview.plannedFolderRemovals} empty folders` : ""}`
            : "Scanning..."}
        </span>
      </div>

      {plan.reasoning &&
      !isContradictoryOrganizationReasoning(plan.reasoning, plan) ? (
        <p className="filesystem-proposal-reasoning">{plan.reasoning}</p>
      ) : null}
      <p className="filesystem-plan-summary">
        <strong>
          {plan.groupBy[0] === "root"
            ? `Move ${preview?.plannedMoves ?? "all"} files to the main folder`
            : `Organize ${preview?.plannedMoves ?? "the"} files by ${organizationLabel(plan)}`}
        </strong>
        <span>
          {plan.removeEmptyFolders
            ? `Afterward, remove ${preview?.plannedFolderRemovals ?? "the"} subfolders confirmed empty.`
            : "Existing folders will be left in place."}
        </span>
      </p>
      {preview ? (
        <>
          <p className="filesystem-plan-facts">
            {preview.totalFiles.toLocaleString()} files currently eligible
            {preview.collisionRenames
              ? ` / ${preview.collisionRenames.toLocaleString()} duplicate names will be safely numbered`
              : " / no duplicate names"}
          </p>
          {preview.sampleActions.length ? (
            <details className="filesystem-plan-options">
              <summary>Review a few example moves</summary>
              <ol className="filesystem-action-list">
                {preview.sampleActions.slice(0, 4).map((action, index) => (
                  <li
                    key={`${action.type}-${index}-${getActionLabel(action)}`}
                    className={`filesystem-action filesystem-action-${action.type}`}
                  >
                    <span className="filesystem-action-number">{index + 1}</span>
                    <span>{getActionLabel(action)}</span>
                  </li>
                ))}
              </ol>
              <p className="filesystem-proposal-reasoning">
                These are examples only. One reviewed rule covers all {preview.plannedMoves} moves.
              </p>
            </details>
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
      {isExecuting && executionProgress ? (
        <div className="filesystem-execution-progress" role="status" aria-live="polite">
          <div>
            <strong>
              {executionProgress.phase === "cleaning"
                ? "Checking for empty folders…"
                : `Moving ${executionProgress.processed.toLocaleString()} of ${executionProgress.total.toLocaleString()} files…`}
            </strong>
            <span>{Math.round((executionProgress.processed / Math.max(1, executionProgress.total)) * 100)}%</span>
          </div>
          <progress
            max={Math.max(1, executionProgress.total)}
            value={executionProgress.processed}
          />
          <small>You can keep watching this card; files are being changed directly in the selected folder.</small>
          {executionProgress.failed ? (
            <small>
              {executionProgress.failed.toLocaleString()} inaccessible or changing files will remain safely in place; the organizer is continuing.
            </small>
          ) : null}
        </div>
      ) : null}
      {preview && !hasReviewableChanges && !preview.conflicts ? (
        <p className="filesystem-proposal-status">
          No files or empty folders need changes for this plan.
        </p>
      ) : null}
      {preview ? (
        <>
          <div className="filesystem-proposal-actions">
            <button
              type="button"
              className="filesystem-apply-button"
              disabled={
                isExecuting ||
                !hasReviewableChanges
              }
              onClick={() => void applyPlan()}
            >
              {isExecuting
                ? "Organizing..."
                : plan.removeEmptyFolders
                  ? "Organize files and remove empty folders"
                  : "Organize files"}
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
  requestContent?: string;
  basePath: string;
  onApplied?: () => void | Promise<void>;
};

export function FilesystemProposalParser({
  content,
  requestContent = "",
  basePath,
  onApplied,
}: ProposalParserProps) {
  const proposal = useMemo(
    () => parseProposedActionsFromContent(content),
    [content],
  );
  const organizationPlan = useMemo(() => {
    const parsed = parseOrganizationPlanFromContent(content);
    if (!parsed || !explicitlyRequestsFolderRemoval(requestContent)) {
      return parsed;
    }
    return { ...parsed, removeEmptyFolders: true };
  }, [content, requestContent]);
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
