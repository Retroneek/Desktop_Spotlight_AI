import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  liveWorkspaceToolProtocol,
  projectFileSelectionProtocol,
  projectRoutingProtocol,
  resolveProjectRoutingDecision,
} from "./chatProtocol";
import { normalizeOllamaBaseUrl } from "./endpoint";

const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";

export type OllamaModel = {
  name?: string;
  model?: string;
  modified_at?: string;
  size?: number;
};

export type OllamaChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type OllamaChatOptions = {
  temperature?: number;
  top_p?: number;
  repeat_penalty?: number;
  num_ctx?: number;
  num_predict?: number;
};

type TagsResponse = {
  models?: OllamaModel[];
};

type GenerateResponse = {
  error?: string;
};

type ChatStreamChunk = {
  model?: string;
  message?: {
    role?: string;
    content?: string;
  };
  response?: string;
  done?: boolean;
  done_reason?: string;
  error?: string;
};

type ChatResponse = {
  message?: {
    role?: string;
    content?: string;
    tool_calls?: OllamaToolCall[];
  };
};

type OllamaToolCall = {
  type?: string;
  function?: {
    index?: number;
    name?: string;
    arguments?: unknown;
  };
};

type WorkspaceToolExecutor = (
  name: string,
  argumentsValue: Record<string, unknown>,
) => Promise<string>;

const liveWorkspaceTools = [
  {
    type: "function",
    function: {
      name: "list_workspace_directory",
      description:
        "List one directory from the live Windows workspace with pagination. Use an empty path for the workspace root.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative directory path, or empty for root." },
          cursor: { type: "integer", minimum: 0 },
          limit: { type: "integer", minimum: 1, maximum: 200 },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_workspace_paths",
      description:
        "Search current file and folder paths in the complete live workspace. Results are paginated and contain metadata only.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Words or extension text to match in relative paths." },
          cursor: { type: "integer", minimum: 0 },
          limit: { type: "integer", minimum: 1, maximum: 200 },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "inspect_workspace_entries",
      description:
        "Inspect current filesystem metadata for exact relative paths. Supported audio files also return embedded title, artist, album, genre, track, duration, bitrate, sample rate, and channel metadata without sending raw media.",
      parameters: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: 64,
          },
        },
        required: ["paths"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_workspace_text_files",
      description:
        "Read the current contents of exact safe text-file paths from the live workspace in one batch. Binary, private, ignored, and oversized files are rejected.",
      parameters: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: 8,
          },
        },
        required: ["paths"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_workspace_text_chunk",
      description:
        "Read one current text file in consecutive byte chunks. Use nextOffset from the result to continue large files without loading or copying the whole file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Exact relative text-file path." },
          offset: { type: "integer", minimum: 0 },
          maxBytes: { type: "integer", minimum: 1000, maximum: 16000 },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
] as const;

export type ProjectFileCandidate = {
  path: string;
  size: number;
  readable: boolean;
};

export type InspectedProjectFile = {
  path: string;
  contents: string;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown Ollama error.";
}

function normalizeToolArguments(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function ollamaFetch(input: string, init?: RequestInit) {
  if (!isTauri()) {
    const browserHeaders = new Headers(init?.headers);
    browserHeaders.delete("Origin");

    return window.fetch(input, {
      ...init,
      headers: browserHeaders,
    });
  }

  const nativeHeaders = new Headers(init?.headers);
  nativeHeaders.set("Origin", "");

  return tauriFetch(input, {
    ...init,
    headers: nativeHeaders,
  });
}

async function readOllamaError(response: Response) {
  const raw = await response.text().catch(() => "");

  if (!raw.trim()) {
    return response.statusText || "Bad Request";
  }

  try {
    const parsed = JSON.parse(raw) as { error?: string };
    return parsed.error || raw;
  } catch {
    return raw;
  }
}

export function useOllama(baseUrl = DEFAULT_OLLAMA_BASE_URL) {
  const normalizedBaseUrl =
    normalizeOllamaBaseUrl(baseUrl) || DEFAULT_OLLAMA_BASE_URL;
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const modelRefreshIdRef = useRef(0);

  const refreshModels = useCallback(async () => {
    const refreshId = modelRefreshIdRef.current + 1;
    modelRefreshIdRef.current = refreshId;
    try {
      const response = await ollamaFetch(`${normalizedBaseUrl}/api/tags`);

      if (!response.ok) {
        const detail = await readOllamaError(response);
        throw new Error(
          `Failed to load Ollama models (${response.status}): ${detail}`,
        );
      }

      const data = (await response.json()) as TagsResponse;
      if (modelRefreshIdRef.current !== refreshId) return;
      setModels(Array.isArray(data.models) ? data.models : []);
      setError(null);
    } catch (err) {
      if (modelRefreshIdRef.current !== refreshId) return;
      const message = getErrorMessage(err);
      setError(message);
      setModels([]);
    }
  }, [normalizedBaseUrl]);

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  const warmModel = useCallback(
    async (model: string) => {
      const selectedModel = model.trim();
      if (!selectedModel) return false;

      try {
        const response = await ollamaFetch(
          `${normalizedBaseUrl}/api/generate`,
          {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: selectedModel,
            prompt: "",
            stream: false,
            keep_alive: "10m",
          }),
          },
        );

        if (!response.ok) {
          return false;
        }

        const data = (await response.json()) as GenerateResponse;
        return !data.error;
      } catch {
        return false;
      }
    },
    [normalizedBaseUrl],
  );

  const shouldReadProject = useCallback(
    async (
      latestPrompt: string,
      model: string,
      recentMessages: OllamaChatMessage[] = [],
    ) => {
      const selectedModel = model.trim();

      if (!selectedModel) {
        throw new Error("No model selected. Install a local assistant model.");
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsGenerating(true);
      setError(null);

      try {
        const response = await ollamaFetch(`${normalizedBaseUrl}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: selectedModel,
            messages: [
              {
                role: "system",
                content: projectRoutingProtocol,
              },
              ...recentMessages.slice(-3).map((message) => ({
                role: message.role,
                content: message.content.slice(0, 600),
              })),
              {
                role: "user",
                content: `Latest message:\n${latestPrompt}`,
              },
            ],
            format: {
              type: "object",
              properties: {
                readProject: {
                  type: "boolean",
                },
              },
              required: ["readProject"],
              additionalProperties: false,
            },
            stream: false,
            options: {
              temperature: 0,
              num_ctx: 2048,
              num_predict: 40,
            },
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const detail = await readOllamaError(response);
          throw new Error(`Ollama API error ${response.status}: ${detail}`);
        }

        const data = (await response.json()) as ChatResponse;
        const decision = JSON.parse(data.message?.content ?? "{}") as {
          readProject?: unknown;
        };

        return resolveProjectRoutingDecision(
          decision.readProject === true,
          latestPrompt,
          recentMessages,
        );
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new Error("Generation canceled.");
        }

        const message = getErrorMessage(err);
        setError(message);
        throw new Error(message);
      } finally {
        setIsGenerating(false);
        abortControllerRef.current = null;
      }
    },
    [normalizedBaseUrl],
  );

  const selectProjectFiles = useCallback(
    async (
      latestPrompt: string,
      model: string,
      candidates: ProjectFileCandidate[],
      inspectedFiles: InspectedProjectFile[] = [],
    ) => {
      const selectedModel = model.trim();
      const inspectedPaths = new Set(inspectedFiles.map((file) => file.path));
      const readableCandidates = candidates
        .filter(
          (candidate) =>
            candidate.readable && !inspectedPaths.has(candidate.path),
        )
        .slice(0, 800);
      if (!selectedModel || !readableCandidates.length) return [];

      const candidatePaths = new Set(
        readableCandidates.map((candidate) => candidate.path),
      );
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsGenerating(true);

      try {
        const inventory = readableCandidates
          .map((candidate) => `- ${candidate.path} (${candidate.size} bytes)`)
          .join("\n");
        const inspectedEvidence = inspectedFiles
          .slice(0, 8)
          .map(
            (file) =>
              `Already inspected: ${file.path}\n${file.contents.slice(0, 3_500)}`,
          )
          .join("\n\n---\n\n")
          .slice(0, 10_000);
        const response = await ollamaFetch(`${normalizedBaseUrl}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: selectedModel,
            messages: [
              { role: "system", content: projectFileSelectionProtocol },
              {
                role: "user",
                content: `Latest question:\n${latestPrompt}\n\nReadable live-folder inventory not yet inspected:\n${inventory}${
                  inspectedEvidence
                    ? `\n\nEvidence already inspected:\n${inspectedEvidence}`
                    : ""
                }`,
              },
            ],
            format: {
              type: "object",
              properties: {
                paths: {
                  type: "array",
                  items: { type: "string" },
                  maxItems: 8,
                },
              },
              required: ["paths"],
              additionalProperties: false,
            },
            stream: false,
            options: {
              temperature: 0,
              num_ctx: 4096,
              num_predict: 160,
            },
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const detail = await readOllamaError(response);
          throw new Error(`Ollama API error ${response.status}: ${detail}`);
        }

        const data = (await response.json()) as ChatResponse;
        const selection = JSON.parse(data.message?.content ?? "{}") as {
          paths?: unknown;
        };
        if (!Array.isArray(selection.paths)) return [];

        return [
          ...new Set(
            selection.paths.filter(
              (path): path is string =>
                typeof path === "string" && candidatePaths.has(path),
            ),
          ),
        ].slice(0, 8);
      } catch (caughtError) {
        if (caughtError instanceof Error && caughtError.name === "AbortError") {
          throw new Error("Generation canceled.");
        }
        throw caughtError;
      } finally {
        setIsGenerating(false);
        abortControllerRef.current = null;
      }
    },
    [normalizedBaseUrl],
  );

  const runLiveWorkspaceAgent = useCallback(
    async (
      initialMessages: OllamaChatMessage[],
      model: string,
      executeTool: WorkspaceToolExecutor,
      onChunk: (chunk: string) => void,
      options?: OllamaChatOptions,
      onToolActivity?: (activity: string) => void,
    ) => {
      const selectedModel = model.trim();
      if (!selectedModel) {
        throw new Error("No model selected. Install a local assistant model.");
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsGenerating(true);
      setError(null);

      type ToolLoopMessage = {
        role: "system" | "user" | "assistant" | "tool";
        content: string;
        tool_calls?: OllamaToolCall[];
        tool_name?: string;
      };
      const lastMessage = initialMessages[initialMessages.length - 1];
      const messages: ToolLoopMessage[] = [
        ...initialMessages.slice(0, -1),
        { role: "system", content: liveWorkspaceToolProtocol },
        ...(lastMessage ? [lastMessage] : []),
      ];
      let toolCallCount = 0;
      let successfulToolCallCount = 0;

      try {
        for (let round = 0; round < 8; round += 1) {
          const response = await ollamaFetch(`${normalizedBaseUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: selectedModel,
              messages,
              tools: liveWorkspaceTools,
              stream: false,
              options: {
                temperature: options?.temperature ?? 0,
                top_p: options?.top_p ?? 0.85,
                repeat_penalty: options?.repeat_penalty ?? 1.05,
                num_ctx: options?.num_ctx ?? 16384,
                num_predict: options?.num_predict ?? 1200,
              },
            }),
            signal: controller.signal,
          });
          if (!response.ok) {
            const detail = await readOllamaError(response);
            throw new Error(`Ollama workspace tools unavailable (${response.status}): ${detail}`);
          }

          const data = (await response.json()) as ChatResponse;
          const content = data.message?.content?.trim() ?? "";
          const toolCalls = Array.isArray(data.message?.tool_calls)
            ? data.message.tool_calls
            : [];

          if (!toolCalls.length) {
            if (toolCallCount === 0 || successfulToolCallCount === 0) {
              throw new Error(
                toolCallCount === 0
                  ? "The selected model did not use the live workspace tools."
                  : "The live workspace could not be inspected successfully.",
              );
            }
            if (!content) {
              throw new Error("Ollama returned no answer from the live workspace.");
            }
            onChunk(content);
            return content;
          }

          messages.push({
            role: "assistant",
            content,
            tool_calls: toolCalls,
          });
          for (const toolCall of toolCalls) {
            toolCallCount += 1;
            if (toolCallCount > 24) {
              throw new Error("The live workspace inspection requested too many tool calls.");
            }
            const toolName = toolCall.function?.name?.trim() ?? "";
            onToolActivity?.(
              {
                list_workspace_directory: "Browsing the live folder...",
                search_workspace_paths: "Searching the live folder...",
                inspect_workspace_entries: "Inspecting current file metadata...",
                read_workspace_text_files: "Reading current files in a batch...",
                read_workspace_text_chunk: "Reading the next file section...",
              }[toolName] ?? "Inspecting the live workspace...",
            );
            const toolArguments = normalizeToolArguments(
              toolCall.function?.arguments,
            );
            let result: string;
            try {
              result = await executeTool(toolName, toolArguments);
              successfulToolCallCount += 1;
            } catch (toolError) {
              result = `Tool error: ${getErrorMessage(toolError)}`;
            }
            messages.push({
              role: "tool",
              tool_name: toolName,
              content: result.slice(0, 18_000),
            });
          }
        }

        throw new Error(
          "The live workspace inspection reached its turn limit before answering.",
        );
      } catch (caughtError) {
        if (caughtError instanceof Error && caughtError.name === "AbortError") {
          throw new Error("Generation canceled.");
        }
        throw caughtError;
      } finally {
        onToolActivity?.("");
        setIsGenerating(false);
        abortControllerRef.current = null;
      }
    },
    [normalizedBaseUrl],
  );

  const streamChat = useCallback(
    async (
      messagesOrPrompt: OllamaChatMessage[] | string,
      model: string,
      onChunk: (chunk: string) => void,
      options?: OllamaChatOptions,
    ) => {
      const selectedModel = model.trim();

      if (!selectedModel) {
        throw new Error(
          "No model selected. Install a local assistant model."
        );
      }

      const messages: OllamaChatMessage[] =
        typeof messagesOrPrompt === "string"
          ? [{ role: "user", content: messagesOrPrompt }]
          : messagesOrPrompt;

      if (!messages.length) {
        throw new Error("No messages were provided to Ollama.");
      }

      setIsGenerating(true);
      setError(null);

      try {
        const controller = new AbortController();
        abortControllerRef.current = controller;

        async function runChatRequest(
          requestMessages: OllamaChatMessage[],
          optionsForRequest?: OllamaChatOptions,
        ) {
          const response = await ollamaFetch(
            `${normalizedBaseUrl}/api/chat`,
            {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: selectedModel,
              messages: requestMessages,
              stream: true,
              ...(optionsForRequest ? { options: optionsForRequest } : {}),
            }),
              signal: controller.signal,
            },
          );

          if (!response.ok) {
            const detail = await readOllamaError(response);
            throw new Error(`Ollama API error ${response.status}: ${detail}`);
          }

          if (!response.body) {
            throw new Error("Ollama returned no response stream.");
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();

          let buffer = "";
          let fullText = "";
          let doneReason = "";

          function handleLine(line: string) {
            const trimmed = line.trim();
            if (!trimmed) return;

            const parsed = JSON.parse(trimmed) as ChatStreamChunk;

            if (parsed.error) {
              throw new Error(parsed.error);
            }

            if (parsed.done_reason) {
              doneReason = parsed.done_reason;
            }

            const chunk = parsed.message?.content ?? parsed.response ?? "";

            if (chunk) {
              fullText += chunk;
              onChunk(chunk);
            }
          }

          while (true) {
            const { value, done } = await reader.read();

            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              handleLine(line);
            }
          }

          if (buffer.trim()) {
            handleLine(buffer);
          }

          return { text: fullText, doneReason };
        }

        let result = await runChatRequest(messages, options);

        if (!result.text.trim() && options) {
          result = await runChatRequest(messages);
        }

        if (!result.text.trim()) {
          throw new Error(
            "Ollama returned an empty response. The selected model may not support this chat request, or Ollama may need a restart.",
          );
        }

        return result.text;
      } catch (err) {
        if (
          err instanceof Error &&
          err.name === "AbortError"
        ) {
          throw new Error("Generation canceled.");
        }

        const message = getErrorMessage(err);
        setError(message);
        throw new Error(message);
      } finally {
        setIsGenerating(false);
        abortControllerRef.current = null;
      }
    },
    [normalizedBaseUrl],
  );

  const cancelChat = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  return {
    models,
    isGenerating,
    error,
    refreshModels,
    cancelChat,
    shouldReadProject,
    selectProjectFiles,
    runLiveWorkspaceAgent,
    streamChat,
    warmModel,
  };
}
