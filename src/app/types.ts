import type { ContextAttachment } from "../services/contextBuilder";

export type Theme = "dark" | "light";
export type AttachedFile = ContextAttachment;

export type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  files?: AttachedFile[];
  createdAt?: number;
};

export type ChatSession = {
  id: string;
  title: string;
  turns: ChatTurn[];
  createdAt: number;
  updatedAt: number;
};

export type RegenerateTarget = {
  userTurn: ChatTurn;
  assistantTurn: ChatTurn;
  historyBeforeUserTurn: ChatTurn[];
};

export type OllamaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type HistoryMenuState = {
  sessionId: string;
  x: number;
  y: number;
};

export type FilesystemAction =
  | { type: "move"; from: string; to: string }
  | { type: "rename"; path: string; newName: string }
  | { type: "createFolder"; path: string }
  | { type: "delete"; path: string }
  | { type: "copy"; from: string; to: string };

export type FilesystemProposal = {
  id: string;
  actions: FilesystemAction[];
  reasoning: string;
  approved: boolean;
  appliedAt?: number;
};

export type OrganizationGrouping = "fileType" | "alphabet" | "root";

export type OrganizationPlan = {
  groupBy: OrganizationGrouping[];
  scope: "allFiles";
  reasoning: string;
  removeEmptyFolders: boolean;
};

export type OrganizationPreview = {
  fingerprint: string;
  totalFiles: number;
  plannedMoves: number;
  unchangedFiles: number;
  conflicts: number;
  batchCount: number;
  plannedFolderRemovals: number;
  typeBreakdown: Record<string, number>;
  sampleActions: FilesystemAction[];
};
