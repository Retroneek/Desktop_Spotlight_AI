import { useCallback, useEffect, useRef, useState } from "react";

const OLLAMA_BASE_URL = "http://127.0.0.1:11434";

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

type TagsResponse = {
  models?: OllamaModel[];
};

type ChatStreamChunk = {
  model?: string;
  message?: {
    role?: string;
    content?: string;
  };
  response?: string;
  done?: boolean;
  error?: string;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown Ollama error.";
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

export function useOllama() {
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const refreshModels = useCallback(async () => {
    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);

      if (!response.ok) {
        throw new Error(`Failed to load Ollama models: ${response.statusText}`);
      }

      const data = (await response.json()) as TagsResponse;
      setModels(Array.isArray(data.models) ? data.models : []);
      setError(null);
    } catch (err) {
      const message = getErrorMessage(err);
      setError(message);
      setModels([]);
    }
  }, []);

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  const streamChat = useCallback(
    async (
      messagesOrPrompt: OllamaChatMessage[] | string,
      model: string,
      onChunk: (chunk: string) => void,
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

        const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: selectedModel,
            messages,
            stream: true,
          }),
          signal: controller.signal,
        });

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

        function handleLine(line: string) {
          const trimmed = line.trim();
          if (!trimmed) return;

          const parsed = JSON.parse(trimmed) as ChatStreamChunk;

          if (parsed.error) {
            throw new Error(parsed.error);
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

        return fullText;
      } catch (err) {
        if (
          err instanceof Error &&
          err.name === "AbortError"
        ) {
          const message = "Generation canceled.";
          setError(message);
          throw new Error(message);
        }

        const message = getErrorMessage(err);
        setError(message);
        throw new Error(message);
      } finally {
        setIsGenerating(false);
        abortControllerRef.current = null;
      }
    },
    [],
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
    streamChat,
  };
}