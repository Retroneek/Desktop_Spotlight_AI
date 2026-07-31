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
