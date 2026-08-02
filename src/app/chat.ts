import {
  buildAttachmentStateContext,
  buildCompactPrompt,
  buildFocusedFolderContext,
  buildPrompt,
  truncateContext,
} from "../services/contextBuilder";
import {
  conversationProtocol,
  filesystemOperationProtocol,
  referenceResolutionProtocol,
} from "../services/chatProtocol";
import type { OllamaChatOptions } from "../services/ollama";
import { runtimeProfiles, type HardwareProfileId } from "./config";
import type { AttachedFile, ChatSession, OllamaMessage } from "./types";

export type HistoryMode = "full" | "user-only" | "none";

export function buildMessages(
  session: ChatSession,
  prompt: string,
  hardwareProfile: HardwareProfileId,
  files: AttachedFile[],
  backgroundContext = "",
  historyMode: HistoryMode = "full",
): OllamaMessage[] {
  const runtimeProfile = runtimeProfiles[hardwareProfile];
  const hasFolderContext = files.some((file) => file.kind === "folder");
  const hasWritableFolderContext = files.some(
    (file) => file.kind === "folder" && Boolean(file.sourcePath),
  );
  const recentMessageCount = hasFolderContext
    ? Math.min(2, runtimeProfile.recentMessageCount)
    : runtimeProfile.recentMessageCount;
  const recentMessages: OllamaMessage[] = session.turns
    .filter((turn) => {
      const content = turn.content.trim();
      return (
        (historyMode === "full" ||
          (historyMode === "user-only" && turn.role === "user")) &&
        content &&
        !content.startsWith("Error:")
      );
    })
    .slice(-recentMessageCount)
    .map((turn) => {
      const directTurnFiles =
        turn.role === "user"
          ? (turn.files ?? []).filter((file) => file.kind === "file")
          : [];
      const historicalContent = directTurnFiles.length
        ? buildPrompt(turn.content, directTurnFiles)
        : turn.content;

      return {
        role: turn.role,
        content: hasFolderContext
          ? truncateContext(
              historicalContent,
              turn.role === "assistant" ? 300 : 600,
            )
          : historicalContent,
      };
    });
  const attachmentStateContext = buildAttachmentStateContext(files);

  return [
    { role: "system", content: conversationProtocol },
    ...(hasWritableFolderContext
      ? [{ role: "system" as const, content: filesystemOperationProtocol }]
      : []),
    ...(attachmentStateContext
      ? [{ role: "system" as const, content: attachmentStateContext }]
      : []),
    ...(backgroundContext
      ? [{ role: "system" as const, content: backgroundContext }]
      : []),
    ...recentMessages,
    ...(recentMessages.length
      ? [{ role: "system" as const, content: referenceResolutionProtocol }]
      : []),
    { role: "user", content: prompt },
  ];
}

export function buildAttachmentAwarePrompt(
  content: string,
  directFiles: AttachedFile[],
  folderFiles: AttachedFile[],
  compact = false,
  retrievalQuery = content,
) {
  const prompt = compact
    ? buildCompactPrompt(content, directFiles)
    : buildPrompt(content, directFiles);

  if (!folderFiles.length) return prompt;

  const attachmentState = folderFiles
    .map((folder) => {
      const includedFiles = folder.folderStats?.filesIncluded;
      const countLabel =
        typeof includedFiles === "number"
          ? folder.sourcePath
            ? `, ${folder.folderStats?.filesFound ?? includedFiles} live entries, ${includedFiles} text files readable on demand`
            : `, ${includedFiles} files included in the snapshot`
          : "";
      return `Attached project folder: ${folder.name}${countLabel}.`;
    })
    .join("\n");
  const focusedEvidence = folderFiles
    .map((folder) => buildFocusedFolderContext(folder, retrievalQuery))
    .filter(Boolean)
    .join("\n\n---\n\n");

  return `${attachmentState}\n\n${
    focusedEvidence
      ? `<focused_project_evidence readonly="true">\n${focusedEvidence}\n</focused_project_evidence>\n\nThe evidence above is existing project code selected for the latest question. Use it as the primary source for the answer. Large files contain sampled complete-line windows; omitted regions and repeated boundary context are not evidence of missing, unfinished, duplicated, or unused code.\n\n`
      : ""
  }${prompt}`;
}

export function buildGenerationOptions(
  files: AttachedFile[],
): OllamaChatOptions {
  if (files.some((file) => file.kind === "folder")) {
    return {
      temperature: 0,
      top_p: 0.85,
      repeat_penalty: 1.05,
      num_ctx: 16384,
      num_predict: 1200,
    };
  }

  if (files.length) {
    return {
      temperature: 0.35,
      top_p: 0.9,
      repeat_penalty: 1.1,
      num_ctx: 8192,
      num_predict: 1000,
    };
  }

  return {
    temperature: 0.5,
    top_p: 0.9,
    repeat_penalty: 1.08,
    num_ctx: 4096,
    num_predict: 800,
  };
}
