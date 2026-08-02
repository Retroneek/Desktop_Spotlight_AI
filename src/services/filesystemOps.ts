import { invoke } from "@tauri-apps/api/core";
import type {
  FilesystemAction,
  FilesystemProposal,
  OrganizationPlan,
  OrganizationPreview,
} from "../app/types";

export type FilesystemOperationResult = {
  success: boolean;
  message: string;
};

const maximumProposedActions = 250;
const maximumPathLength = 500;
const spotlightCommandBlockPattern = /```spotlight\s*([\s\S]*?)```/gi;
const legacyJsonBlockPattern = /```json\s*([\s\S]*?)```/gi;
const quotedCommandValue = `"(?:[^"\\\\]|\\\\.)*"`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeRelativePath(value: unknown) {
  if (typeof value !== "string") return false;

  const path = value.trim();
  if (
    !path ||
    path.length > maximumPathLength ||
    /[\u0000-\u001f]/.test(path) ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[a-z]:/i.test(path)
  ) {
    return false;
  }

  const segments = path.replace(/\\/g, "/").split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}

function isSafeFileName(value: unknown) {
  return (
    isSafeRelativePath(value) &&
    typeof value === "string" &&
    !value.includes("/") &&
    !value.includes("\\")
  );
}

function isFilesystemAction(value: unknown): value is FilesystemAction {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  switch (value.type) {
    case "move":
    case "copy":
      return isSafeRelativePath(value.from) && isSafeRelativePath(value.to);
    case "rename":
      return isSafeRelativePath(value.path) && isSafeFileName(value.newName);
    case "createFolder":
    case "delete":
      return isSafeRelativePath(value.path);
    default:
      return false;
  }
}

function createStableProposalId(value: string) {
  let hash = 2_166_136_261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return `filesystem-proposal-${(hash >>> 0).toString(16)}`;
}

function commandLines(block: string) {
  return block
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseOrganizationCommandBlock(block: string): OrganizationPlan | null {
  const lines = commandLines(block);
  const organizationLines = lines.filter((line) => /^(?:organize|flatten)\s+/i.test(line));
  if (organizationLines.length !== 1) return null;

  const normalizedOrganization = organizationLines[0]
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  const groupBy = (() => {
    switch (normalizedOrganization) {
      case "organize-root":
      case "flatten-root":
      case "flatten-to-root":
        return ["root"] as const;
      case "organize-file-type":
      case "organize-filetype":
      case "organize-by-file-type":
      case "organize-by-filetype":
        return ["fileType"] as const;
      case "organize-alphabet":
      case "organize-by-alphabet":
        return ["alphabet"] as const;
      case "organize-file-type-then-alphabet":
      case "organize-filetype-then-alphabet":
        return ["fileType", "alphabet"] as const;
      case "organize-alphabet-then-file-type":
      case "organize-alphabet-then-filetype":
        return ["alphabet", "fileType"] as const;
      default:
        return null;
    }
  })();
  if (!groupBy) return null;

  let removeEmptyFolders = false;
  let hasCleanupDirective = false;
  for (const line of lines) {
    if (line === organizationLines[0]) continue;
    const normalized = line.toLowerCase().replace(/[_\s]+/g, "-");
    if (
      normalized === "cleanup-empty-folders" ||
      normalized === "remove-empty-folders" ||
      normalized === "cleanup-empty-directories"
    ) {
      if (hasCleanupDirective) return null;
      hasCleanupDirective = true;
      removeEmptyFolders = true;
      continue;
    }
    if (normalized === "keep-empty-folders") {
      if (hasCleanupDirective) return null;
      hasCleanupDirective = true;
      removeEmptyFolders = false;
      continue;
    }
    return null;
  }

  return {
    groupBy: [...groupBy],
    scope: "allFiles",
    reasoning: "",
    removeEmptyFolders,
  };
}

export function containsSpotlightCommandBlock(content: string) {
  return /```spotlight\b/i.test(content);
}

function decodeCommandValue(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function parseActionCommand(line: string): FilesystemAction | null {
  const twoPathCommand = new RegExp(
    `^(move|copy|rename)\\s+(${quotedCommandValue})\\s+to\\s+(${quotedCommandValue})$`,
    "i",
  ).exec(line);
  if (twoPathCommand) {
    const operation = twoPathCommand[1].toLowerCase();
    const first = decodeCommandValue(twoPathCommand[2]);
    const second = decodeCommandValue(twoPathCommand[3]);
    if (!first || !second) return null;
    const action: FilesystemAction =
      operation === "rename"
        ? { type: "rename", path: first, newName: second }
        : operation === "copy"
          ? { type: "copy", from: first, to: second }
          : { type: "move", from: first, to: second };
    return isFilesystemAction(action) ? action : null;
  }

  const onePathCommand = new RegExp(
    `^(create-folder|delete)\\s+(${quotedCommandValue})$`,
    "i",
  ).exec(line);
  if (!onePathCommand) return null;
  const path = decodeCommandValue(onePathCommand[2]);
  if (!path) return null;
  const action: FilesystemAction =
    onePathCommand[1].toLowerCase() === "delete"
      ? { type: "delete", path }
      : { type: "createFolder", path };
  return isFilesystemAction(action) ? action : null;
}

function parseActionCommandBlock(block: string): FilesystemProposal | null {
  const lines = commandLines(block);
  if (!lines.length || lines.length > maximumProposedActions) return null;
  const actions = lines.map(parseActionCommand);
  if (actions.some((action) => action === null)) return null;
  return {
    id: createStableProposalId(block),
    actions: actions as FilesystemAction[],
    reasoning: "",
    approved: false,
  };
}

export async function executeFilesystemOperations(
  basePath: string,
  actions: FilesystemAction[],
): Promise<FilesystemOperationResult> {
  return invoke("execute_filesystem_operations", {
    basePath,
    actions,
  });
}

export function previewOrganizationPlan(
  basePath: string,
  plan: OrganizationPlan,
) {
  return invoke<OrganizationPreview>("preview_organization_plan", {
    basePath,
    plan,
  });
}

export function executeOrganizationPlan(
  basePath: string,
  plan: OrganizationPlan,
  expectedFingerprint: string,
) {
  return invoke<FilesystemOperationResult>("execute_organization_plan", {
    basePath,
    plan,
    expectedFingerprint,
  });
}

export function parseOrganizationPlanFromContent(
  content: string,
): OrganizationPlan | null {
  for (const match of content.matchAll(spotlightCommandBlockPattern)) {
    const plan = parseOrganizationCommandBlock(match[1]);
    if (plan) return plan;
  }

  // Compatibility only: older saved conversations can still render their
  // reviewed plans, but new model instructions never request JSON.
  for (const match of content.matchAll(legacyJsonBlockPattern)) {
    try {
      const parsed: unknown = JSON.parse(match[1]);
      if (!isRecord(parsed) || !isRecord(parsed.organizationPlan)) continue;
      const rawPlan = parsed.organizationPlan;
      if (!Array.isArray(rawPlan.groupBy)) continue;

      const groupBy = [
        ...new Set(
          rawPlan.groupBy.filter(
            (group): group is OrganizationPlan["groupBy"][number] =>
              group === "fileType" || group === "alphabet" || group === "root",
          ),
        ),
      ];
      if (!groupBy.length || groupBy.length !== rawPlan.groupBy.length) {
        continue;
      }
      if (groupBy.includes("root") && groupBy.length !== 1) continue;

      const reasoning =
        typeof parsed.reasoning === "string"
          ? parsed.reasoning.trim().slice(0, 2_000)
          : "";
      return {
        groupBy,
        scope: "allFiles",
        reasoning,
        removeEmptyFolders: rawPlan.removeEmptyFolders === true,
      };
    } catch {
      // Keep looking when a response contains unrelated JSON first.
    }
  }

  return null;
}

export function parseProposedActionsFromContent(
  content: string,
): FilesystemProposal | null {
  for (const match of content.matchAll(spotlightCommandBlockPattern)) {
    const proposal = parseActionCommandBlock(match[1]);
    if (proposal) return proposal;
  }

  // Compatibility only for proposals already stored in chat history.
  for (const match of content.matchAll(legacyJsonBlockPattern)) {
    try {
      const parsed: unknown = JSON.parse(match[1]);
      if (!isRecord(parsed) || !Array.isArray(parsed.actions)) continue;
      if (
        parsed.actions.length === 0 ||
        parsed.actions.length > maximumProposedActions ||
        !parsed.actions.every(isFilesystemAction)
      ) {
        continue;
      }
      if (
        parsed.reasoning !== undefined &&
        (typeof parsed.reasoning !== "string" || parsed.reasoning.length > 2_000)
      ) {
        continue;
      }

      return {
        id: createStableProposalId(match[1]),
        actions: parsed.actions,
        reasoning: parsed.reasoning?.trim() ?? "",
        approved: false,
      };
    } catch {
      // A response may contain unrelated JSON before a valid proposal.
    }
  }

  return null;
}
