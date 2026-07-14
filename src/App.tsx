import {
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useOllama } from "./services/ollama";
import "./App.css";

const presets = [
  {
    id: "lite",
    label: "Lite",
    description: "Fast answers for smaller files and quick summaries.",
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Default mix of speed and reasoning depth.",
  },
  {
    id: "pro",
    label: "Pro",
    description: "Best for longer prompts and more careful analysis.",
  },
] as const;

type PresetId = (typeof presets)[number]["id"];
type Theme = "dark" | "light";

type AttachedFile = {
  id: string;
  name: string;
  typeLabel: string;
  sizeLabel: string;
  preview: string;
  supported: boolean;
};

type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  files?: AttachedFile[];
};

type ChatSession = {
  id: string;
  title: string;
  turns: ChatTurn[];
  createdAt: number;
  updatedAt: number;
};

type OllamaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type AnswerLength = "short" | "medium" | "long";

type HistoryMenuState = {
  sessionId: string;
  x: number;
  y: number;
};

type IconProps = {
  className?: string;
};

const storageKey = "desktop-spotlight-ai-chats";
const activeChatStorageKey = "desktop-spotlight-ai-active-chat";
const attachmentStorageKey = "desktop-spotlight-ai-attached-files";
const themeStorageKey = "desktop-spotlight-ai-theme";
const sidebarCollapsedStorageKey =
  "desktop-spotlight-ai-sidebar-collapsed";
const selectedModelStorageKey =
  "desktop-spotlight-ai-selected-model";
const answerLengthStorageKey = "desktop-spotlight-ai-answer-length";
const citationModeStorageKey = "desktop-spotlight-ai-citation-mode";

const maxMessageLines = 10;
const lineHeight = 18;
const verticalPadding = 10;
const maxMessageHeight = lineHeight * maxMessageLines + verticalPadding;

const presetSystemPrompts: Record<PresetId, string> = {
  lite: `
You are Desktop Spotlight AI, a fast local desktop assistant.
You are currently in Lite mode.
For this reply, keep the answer concise, practical, and direct.
Prefer short paragraphs or tight bullet lists.
Unless the user asks for depth, keep the response brief.
Prioritize attached file content when files are included.
Do not invent information that is not present.
`.trim(),

  balanced: `
You are Desktop Spotlight AI, a helpful local desktop assistant.
You are currently in Balanced mode.
For this reply, give clear, direct answers with enough explanation to be useful.
Use moderate detail and keep the structure clean.
Prioritize attached file content when files are included.
Do not invent information that is not present.
`.trim(),

  pro: `
You are Desktop Spotlight AI, a careful local desktop assistant.
You are currently in Pro mode.
For this reply, give thorough, structured answers and explain important tradeoffs.
Go deeper than Lite or Balanced when the user would benefit from it.
Prioritize attached file content when files are included.
Do not invent information that is not present.
`.trim(),
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createSession(title = "New chat"): ChatSession {
  const now = Date.now();

  return {
    id: createId("chat"),
    title,
    turns: [],
    createdAt: now,
    updatedAt: now,
  };
}

function getInitialSessions(): ChatSession[] {
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return [createSession()];

    const parsed = JSON.parse(stored) as ChatSession[];

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [createSession()];
    }

    return parsed.map((session) => ({
      ...session,
      title: typeof session.title === "string" ? session.title : "New chat",
      turns: Array.isArray(session.turns) ? session.turns : [],
      createdAt:
        typeof session.createdAt === "number"
          ? session.createdAt
          : Date.now(),
      updatedAt:
        typeof session.updatedAt === "number"
          ? session.updatedAt
          : Date.now(),
    }));
  } catch {
    return [createSession()];
  }
}

function getInitialAttachedFiles(): AttachedFile[] {
  try {
    const stored = localStorage.getItem(attachmentStorageKey);
    if (!stored) return [];

    const parsed = JSON.parse(stored) as AttachedFile[];
    if (!Array.isArray(parsed)) return [];

    return parsed.map((file) => ({
      id: typeof file.id === "string" ? file.id : createId("file"),
      name: typeof file.name === "string" ? file.name : "Untitled file",
      typeLabel:
        typeof file.typeLabel === "string" ? file.typeLabel : "file",
      sizeLabel:
        typeof file.sizeLabel === "string" ? file.sizeLabel : "0 B",
      preview: typeof file.preview === "string" ? file.preview : "",
      supported: Boolean(file.supported),
    }));
  } catch {
    return [];
  }
}

function getInitialAppState() {
  const sessions = getInitialSessions();

  try {
    const storedActiveId = localStorage.getItem(activeChatStorageKey);

    const activeSessionId =
      storedActiveId &&
      sessions.some((session) => session.id === storedActiveId)
        ? storedActiveId
        : sessions[0].id;

    return {
      sessions,
      activeSessionId,
    };
  } catch {
    return {
      sessions,
      activeSessionId: sessions[0].id,
    };
  }
}

function getInitialTheme(): Theme {
  try {
    return localStorage.getItem(themeStorageKey) === "light"
      ? "light"
      : "dark";
  } catch {
    return "dark";
  }
}

function getInitialSidebarCollapsed() {
  try {
    return localStorage.getItem(sidebarCollapsedStorageKey) === "true";
  } catch {
    return false;
  }
}

function getInitialSelectedModel() {
  try {
    return localStorage.getItem(selectedModelStorageKey) ?? "";
  } catch {
    return "";
  }
}

function getInitialAnswerLength(): AnswerLength {
  try {
    const stored = localStorage.getItem(answerLengthStorageKey);
    if (stored === "short" || stored === "medium" || stored === "long") return stored;
    return "medium";
  } catch {
    return "medium";
  }
}

function getInitialCitationMode(): boolean {
  try {
    return localStorage.getItem(citationModeStorageKey) === "true";
  } catch {
    return false;
  }
}

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isSupportedTextFile(file: File) {
  const lowerName = file.name.toLowerCase();

  return (
    file.type === "text/plain" ||
    file.type === "text/markdown" ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".md")
  );
}

async function summarizeFile(file: File): Promise<AttachedFile> {
  const supported = isSupportedTextFile(file);

  const typeLabel =
    file.type ||
    (file.name.toLowerCase().endsWith(".md")
      ? "text/markdown"
      : "file");

  let preview = "Preview unavailable for this file type.";

  if (supported) {
    const text = await file.text();

    preview = text.trim()
      ? text.trim().slice(0, 2500)
      : "Empty text file.";
  }

  return {
    id: `${file.name}-${file.lastModified}-${file.size}`,
    name: file.name,
    typeLabel,
    sizeLabel: formatFileSize(file.size),
    preview,
    supported,
  };
}

function getModelName(model: unknown) {
  if (typeof model === "string") {
    return model;
  }

  if (typeof model === "object" && model !== null) {
    const candidate = model as {
      name?: unknown;
      model?: unknown;
    };

    if (typeof candidate.name === "string") {
      return candidate.name;
    }

    if (typeof candidate.model === "string") {
      return candidate.model;
    }
  }

  return undefined;
}

function getModelList(models: unknown) {
  if (Array.isArray(models)) {
    return models;
  }

  if (typeof models === "object" && models !== null) {
    const candidate = models as {
      models?: unknown;
    };

    if (Array.isArray(candidate.models)) {
      return candidate.models;
    }
  }

  return [];
}

function getModelDisplayName(modelName: string) {
  const withoutNamespace = modelName.split("/").pop() ?? modelName;
  const baseName = withoutNamespace.replace(/:.+$/i, "");
  const normalized = baseName.toLowerCase();

  const friendlyMatches: Array<[RegExp, string]> = [
    [/^llama(?:-| )?3(?:\.| )?2\b/i, "Llama 3.2"],
    [/^llama(?:-| )?3(?:\.| )?1\b/i, "Llama 3.1"],
    [/^codellama\b/i, "Code Llama"],
    [/^mistral\b/i, "Mistral"],
    [/^mixtral\b/i, "Mixtral"],
    [/^phi(?:-| )?3\b/i, "Phi 3"],
    [/^qwen(?:-| )?2(?:\.| )?5\b/i, "Qwen 2.5"],
    [/^gemma(?:-| )?2\b/i, "Gemma 2"],
    [/^deepseek(?:-| )?coder\b/i, "DeepSeek Coder"],
  ];

  for (const [pattern, label] of friendlyMatches) {
    if (pattern.test(normalized)) {
      return label;
    }
  }

  const titled = baseName
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, (match) => match.toUpperCase());

  if (titled.length <= 18) {
    return titled;
  }

  return `${titled.slice(0, 15)}...`;
}

function getHistoryGroupLabel(timestamp: number) {
  const date = new Date(timestamp);
  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const startOfTarget = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );

  const dayDifference = Math.round(
    (startOfToday.getTime() - startOfTarget.getTime()) /
      (1000 * 60 * 60 * 24),
  );

  if (dayDifference === 0) {
    return "Today";
  }

  if (dayDifference === 1) {
    return "Yesterday";
  }

  if (dayDifference > 1 && dayDifference < 7) {
    return date.toLocaleDateString(undefined, {
      weekday: "long",
    });
  }

  if (date.getFullYear() === today.getFullYear()) {
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function CollapseIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M9.5 3.5 5.5 8l4 4.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function NewChatIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 3.25v9.5M3.25 8h9.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function MoreIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.2" fill="currentColor" />
    </svg>
  );
}

function ThemeIcon({ className, theme }: IconProps & { theme: Theme }) {
  if (theme === "dark") {
    return (
      <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 1.75v1.6M8 12.65v1.6M1.75 8h1.6M12.65 8h1.6M3.4 3.4l1.15 1.15M11.45 11.45l1.15 1.15M3.4 12.6l1.15-1.15M11.45 4.55l1.15-1.15" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M10.95 2.35a5.45 5.45 0 1 0 2.7 10.2A5.9 5.9 0 0 1 10.95 2.35Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function AttachIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M5.9 8.1 9.6 4.4a2.15 2.15 0 1 1 3.05 3.05L7.8 12.3a3.2 3.2 0 1 1-4.55-4.55l5.1-5.1"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function SendIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2.2 7.8 13.5 2.9l-3.9 10.2-2.1-3.2-5.3-2.1Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
      <path d="M13.45 2.95 7.4 9" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </svg>
  );
}

function RegenerateIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2.5 8A5.5 5.5 0 0 1 13 5.5M2.5 8l-2-2m2 2 2-2M13.5 8A5.5 5.5 0 0 1 3 10.5M13.5 8l2 2m-2-2-2 2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function EditIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M10.5 2.5 13.5 5.5l-8 8H2.5v-3l8-8Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function CitationsIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 2.5h10a.5.5 0 0 1 .5.5v10a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M5 5.5h6M5 8h6M5 10.5h3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.3"
      />
    </svg>
  );
}

function buildPrompt(content: string, files: AttachedFile[]) {
  if (!files.length) {
    return content;
  }

  const fileContext = files
    .map((file) => {
      const fileText = file.supported
        ? file.preview
        : "The contents of this file type could not be read.";

      return [
        `File: ${file.name}`,
        `Type: ${file.typeLabel}`,
        `Size: ${file.sizeLabel}`,
        "Contents:",
        fileText,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  return `${content}

Attached file context:

${fileContext}`;
}

function buildMessages(
  historyTurns: ChatTurn[],
  prompt: string,
  preset: PresetId,
  answerLength: AnswerLength,
  citationMode: boolean,
): OllamaMessage[] {
  const recentMessages: OllamaMessage[] = historyTurns
    .filter((turn) => turn.content.trim())
    .slice(-12)
    .map((turn) => ({
      role: turn.role,
      content: turn.content,
    }));

  const lengthAdditions: Record<AnswerLength, string> = {
    short: "\n\nLength: Keep this response very concise — aim for 1 to 3 sentences unless a list or code is more appropriate.",
    medium: "",
    long: "\n\nLength: Provide a detailed, comprehensive response. Elaborate on key points and give full explanations.",
  };

  const citationAddition = citationMode
    ? "\n\nCitations: Where you make factual claims, include inline citations formatted as [1], [2], etc. and list the sources at the end of your reply."
    : "";

  const identityPrompt = `
${presetSystemPrompts[preset]}

The current mode selection is authoritative for this reply.
If earlier messages in this chat used a different tone or depth, ignore that and follow the current mode instead.

You are Desktop Spotlight AI, a local desktop assistant.
Do not claim to be GPT-4, ChatGPT, or an OpenAI model.${lengthAdditions[answerLength]}${citationAddition}
`.trim();

  return [
    {
      role: "system",
      content: identityPrompt,
    },
    ...recentMessages,
    {
      role: "user",
      content: prompt,
    },
  ];
}

function App() {
  const initialStateRef = useRef(getInitialAppState());

  const {
    models,
    streamChat,
    isGenerating,
    error,
    cancelChat,
  } = useOllama();

  const [preset, setPreset] = useState<PresetId>("balanced");
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    getInitialSidebarCollapsed,
  );
  const [selectedModelName, setSelectedModelName] = useState(
    getInitialSelectedModel,
  );
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);

  const [sessions, setSessions] = useState<ChatSession[]>(
    initialStateRef.current.sessions,
  );

  const [activeSessionId, setActiveSessionId] = useState(
    initialStateRef.current.activeSessionId,
  );

  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>(
    getInitialAttachedFiles,
  );

  const [message, setMessage] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const [historyMenu, setHistoryMenu] =
    useState<HistoryMenuState | null>(null);

  const [editingSessionId, setEditingSessionId] =
    useState<string | null>(null);

  const [draftTitle, setDraftTitle] = useState("");
  const [streamingTurnId, setStreamingTurnId] =
    useState<string | null>(null);

  const [answerLength, setAnswerLength] = useState<AnswerLength>(getInitialAnswerLength);
  const [citationMode, setCitationMode] = useState<boolean>(getInitialCitationMode);
  const [editingTurnId, setEditingTurnId] = useState<string | null>(null);
  const [draftTurnContent, setDraftTurnContent] = useState("");

  const messageRef = useRef<HTMLTextAreaElement>(null);
  const editTurnRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const responseLogRef = useRef<HTMLDivElement>(null);
  const streamingTextElementRef = useRef<HTMLParagraphElement>(null);

  const dragDepthRef = useRef(0);
  const streamedTextRef = useRef("");
  const streamFrameRef = useRef<number | null>(null);
  const stickToBottomRef = useRef(true);

  const availableModelNames = useMemo(() => {
    return getModelList(models)
      .map(getModelName)
      .filter((name): name is string => Boolean(name));
  }, [models]);

  const activeModelName =
    selectedModelName &&
    availableModelNames.includes(selectedModelName)
      ? selectedModelName
      : availableModelNames[0] ?? "";

  const selectedPreset =
    presets.find((option) => option.id === preset) ?? presets[1];

  const sortedSessions = useMemo(() => {
    return [...sessions].sort((left, right) => right.updatedAt - left.updatedAt);
  }, [sessions]);

  const historySections = useMemo(() => {
    const sections: Array<{
      label: string;
      sessions: ChatSession[];
    }> = [];

    for (const session of sortedSessions) {
      const label = getHistoryGroupLabel(session.updatedAt);
      const currentSection = sections[sections.length - 1];

      if (!currentSection || currentSection.label !== label) {
        sections.push({ label, sessions: [session] });
        continue;
      }

      currentSection.sessions.push(session);
    }

    return sections;
  }, [sortedSessions]);

  const hasSavedChats = useMemo(() => {
    return sessions.some((session) => session.turns.length > 0);
  }, [sessions]);

  const collapsedPreviewSessions = useMemo(() => {
    return sortedSessions
      .filter((session) => session.turns.length > 0)
      .slice(0, 3);
  }, [sortedSessions]);

  const [isCanceling, setIsCanceling] = useState(false);

  function cyclePreset() {
    const currentIndex = presets.findIndex(
      (option) => option.id === preset,
    );

    const nextPreset =
      presets[(currentIndex + 1) % presets.length];

    setPreset(nextPreset.id);
  }

  const activeSession = useMemo(() => {
    return (
      sessions.find((session) => session.id === activeSessionId) ??
      sessions[0]
    );
  }, [activeSessionId, sessions])!;

  const hasPrompt =
    message.trim().length > 0 || attachedFiles.length > 0;

  const activeSessionHasTurns =
    activeSession.turns.length > 0;

  const hasDraftMessage =
    message.trim().length > 0;

  const emptyStateContent = useMemo(() => {
    if (attachedFiles.length > 0) {
      return {
        title: "Your files are ready.",
        description:
          "Ask for a summary, extract actions, or turn the contents into a draft.",
        prompts: [
          "Summarize the attached notes and pull out the key actions.",
          "Review the attached files and tell me what matters most.",
          "Turn the attached material into a clean message draft.",
        ],
      };
    }

    if (hasDraftMessage) {
      return {
        title: "Draft ready.",
        description:
          "Keep writing, attach a file, or send when you are ready.",
        prompts: [] as string[],
      };
    }

    if (hasSavedChats && activeSessionHasTurns) {
      return {
        title: "Start the next step.",
        description:
          "Continue a chat, drop in another file, or use a quick prompt to get moving.",
        prompts: [
          "Review my last conversation and suggest the next actions.",
          "Draft a follow-up message based on what we already discussed.",
          "Help me compare two ideas and decide what to do next.",
        ],
      };
    }

    return {
      title: "Hi, what can I help with today?",
      description:
        "Drop a file anywhere and ask a question, or start with one of these prompts.",
      prompts: [
        "Summarize the attached notes and pull out the key actions.",
        "Turn this into a clean email draft I can send.",
        "Review this and tell me the most important takeaways.",
      ],
    };
  }, [
    activeSessionHasTurns,
    attachedFiles.length,
    hasDraftMessage,
    hasSavedChats,
  ]);

  const canSend =
    !isGenerating &&
    Boolean(activeModelName) &&
    hasPrompt;

  useEffect(() => {
    const saveTimer = window.setTimeout(() => {
      localStorage.setItem(storageKey, JSON.stringify(sessions));
    }, 250);

    return () => {
      window.clearTimeout(saveTimer);
    };
  }, [sessions]);

  useEffect(() => {
    const saveTimer = window.setTimeout(() => {
      localStorage.setItem(
        attachmentStorageKey,
        JSON.stringify(attachedFiles),
      );
    }, 250);

    return () => {
      window.clearTimeout(saveTimer);
    };
  }, [attachedFiles]);

  useEffect(() => {
    localStorage.setItem(activeChatStorageKey, activeSessionId);
  }, [activeSessionId]);

  useEffect(() => {
    localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(
      sidebarCollapsedStorageKey,
      String(isSidebarCollapsed),
    );
  }, [isSidebarCollapsed]);

  useEffect(() => {
    if (!availableModelNames.length) {
      if (selectedModelName) {
        setSelectedModelName("");
      }

      return;
    }

    if (!selectedModelName) {
      setSelectedModelName(availableModelNames[0]);
      return;
    }

    if (!availableModelNames.includes(selectedModelName)) {
      setSelectedModelName(availableModelNames[0]);
    }
  }, [availableModelNames, selectedModelName]);

  useEffect(() => {
    localStorage.setItem(selectedModelStorageKey, activeModelName);
  }, [activeModelName]);

  useEffect(() => {
    localStorage.setItem(answerLengthStorageKey, answerLength);
  }, [answerLength]);

  useEffect(() => {
    localStorage.setItem(citationModeStorageKey, String(citationMode));
  }, [citationMode]);

  useEffect(() => {
    if (
      !sessions.some(
        (session) => session.id === activeSessionId,
      ) &&
      sessions[0]
    ) {
      setActiveSessionId(sessions[0].id);
    }
  }, [activeSessionId, sessions]);

  useEffect(() => {
    function closeHistoryMenu() {
      setHistoryMenu(null);
      setIsModelMenuOpen(false);
    }

    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;

      setHistoryMenu(null);
      setIsModelMenuOpen(false);
      setEditingSessionId(null);
      setEditingTurnId(null);
    }

    window.addEventListener("pointerdown", closeHistoryMenu);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener(
        "pointerdown",
        closeHistoryMenu,
      );

      window.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (streamFrameRef.current !== null) {
        window.cancelAnimationFrame(streamFrameRef.current);
      }
    };
  }, []);

  useLayoutEffect(() => {
    const textarea = messageRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";

    const nextHeight = Math.min(
      textarea.scrollHeight,
      maxMessageHeight,
    );

    textarea.style.height = `${nextHeight}px`;

    textarea.style.overflowY =
      textarea.scrollHeight > maxMessageHeight
        ? "auto"
        : "hidden";
  }, [message]);

  useLayoutEffect(() => {
    const responseLog = responseLogRef.current;
    if (!responseLog) return;

    stickToBottomRef.current = true;
    responseLog.scrollTop = responseLog.scrollHeight;
  }, [activeSessionId, activeSession.turns.length]);

  function updateTurnContent(
    sessionId: string,
    turnId: string,
    content: string,
  ) {
    setSessions((current) =>
      current.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        return {
          ...session,
          updatedAt: Date.now(),
          turns: session.turns.map((turn) =>
            turn.id === turnId
              ? {
                  ...turn,
                  content,
                }
              : turn,
          ),
        };
      }),
    );
  }

  function queueStreamPaint() {
    if (streamFrameRef.current !== null) {
      return;
    }

    streamFrameRef.current = window.requestAnimationFrame(() => {
      const textElement = streamingTextElementRef.current;
      const responseLog = responseLogRef.current;

      if (textElement) {
        textElement.textContent =
          streamedTextRef.current || "Thinking...";
      }

      if (responseLog && stickToBottomRef.current) {
        responseLog.scrollTop = responseLog.scrollHeight;
      }

      streamFrameRef.current = null;
    });
  }

  async function addFiles(files: FileList | File[]) {
    const fileArray = Array.from(files);
    if (!fileArray.length) return;

    const nextFiles = await Promise.all(
      fileArray.map((file) => summarizeFile(file)),
    );

    setAttachedFiles((current) => {
      const existingIds = new Set(
        current.map((file) => file.id),
      );

      return [
        ...current,
        ...nextFiles.filter(
          (file) => !existingIds.has(file.id),
        ),
      ];
    });
  }

  function createNewChat() {
    const nextSession = createSession();

    setSessions((current) => [
      nextSession,
      ...current,
    ]);

    setActiveSessionId(nextSession.id);
    setAttachedFiles([]);
    setMessage("");
    setHistoryMenu(null);
    setEditingSessionId(null);
  }

  function selectSession(sessionId: string) {
    setActiveSessionId(sessionId);
    setAttachedFiles([]);
    setMessage("");
    setHistoryMenu(null);
    setEditingSessionId(null);
  }

  function startRename(sessionId: string) {
    const session = sessions.find(
      (item) => item.id === sessionId,
    );

    if (!session) return;

    setDraftTitle(session.title);
    setEditingSessionId(sessionId);
    setHistoryMenu(null);
  }

  function commitRename() {
    const nextTitle = draftTitle.trim();

    if (!editingSessionId || !nextTitle) {
      setEditingSessionId(null);
      return;
    }

    setSessions((current) =>
      current.map((session) =>
        session.id === editingSessionId
          ? {
              ...session,
              title: nextTitle,
              updatedAt: Date.now(),
            }
          : session,
      ),
    );

    setEditingSessionId(null);
  }

  function duplicateSession(sessionId: string) {
    const session = sessions.find(
      (item) => item.id === sessionId,
    );

    if (!session) return;

    const now = Date.now();

    const duplicate: ChatSession = {
      ...session,
      id: createId("chat"),
      title: `${session.title} copy`,
      turns: session.turns.map((turn) => ({
        ...turn,
        id: createId(turn.role),
        files: turn.files?.map((file) => ({
          ...file,
        })),
      })),
      createdAt: now,
      updatedAt: now,
    };

    setSessions((current) => [
      duplicate,
      ...current,
    ]);

    setActiveSessionId(duplicate.id);
    setAttachedFiles([]);
    setMessage("");
    setHistoryMenu(null);
  }

  function deleteSession(sessionId: string) {
    const remainingSessions = sessions.filter(
      (session) => session.id !== sessionId,
    );

    const nextSessions = remainingSessions.length
      ? remainingSessions
      : [createSession()];

    setSessions(nextSessions);

    setActiveSessionId((currentId) => {
      const currentStillExists = nextSessions.some(
        (session) => session.id === currentId,
      );

      return currentStillExists
        ? currentId
        : nextSessions[0].id;
    });

    setAttachedFiles([]);
    setMessage("");
    setHistoryMenu(null);
    setEditingSessionId(null);
  }

  function openHistoryMenu(
    sessionId: string,
    x: number,
    y: number,
  ) {
    const menuWidth = 164;
    const menuHeight = 126;
    const padding = 8;

    setHistoryMenu({
      sessionId,
      x: Math.max(
        padding,
        Math.min(x, window.innerWidth - menuWidth - padding),
      ),
      y: Math.max(
        padding,
        Math.min(y, window.innerHeight - menuHeight - padding),
      ),
    });
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function applyStarterPrompt(prompt: string) {
    setMessage(prompt);
    messageRef.current?.focus();
  }

  function removeFile(fileId: string) {
    setAttachedFiles((current) =>
      current.filter((file) => file.id !== fileId),
    );
  }

  async function sendMessage(summarize = false) {
    const trimmedMessage = message.trim();

    if (!trimmedMessage && attachedFiles.length === 0) {
      return;
    }

    if (
      isGenerating ||
      isCanceling ||
      !activeSession ||
      !activeModelName
    ) {
      return;
    }

    const sessionId = activeSession.id;
    const filesForTurn = attachedFiles;

    const visibleContent = summarize
      ? trimmedMessage
        ? `Please summarize the attached file(s) and answer: ${trimmedMessage}`
        : "Please summarize the attached file(s)."
      : trimmedMessage ||
        `Attached ${filesForTurn.length} file(s).`;

    const modelPrompt = buildPrompt(
      visibleContent,
      filesForTurn,
    );

    const messages = buildMessages(
      activeSession.turns,
      modelPrompt,
      preset,
      answerLength,
      citationMode,
    );

    const now = Date.now();

    const userTurn: ChatTurn = {
      id: `user-${now}`,
      role: "user",
      content: visibleContent,
      files: filesForTurn,
    };

    const assistantTurn: ChatTurn = {
      id: `assistant-${now}`,
      role: "assistant",
      content: "Thinking...",
    };

    const automaticTitle =
      trimmedMessage ||
      filesForTurn[0]?.name ||
      "New chat";

    setSessions((current) =>
      current.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        return {
          ...session,
          title:
            session.title === "New chat"
              ? automaticTitle.slice(0, 42)
              : session.title,
          turns: [
            ...session.turns,
            userTurn,
            assistantTurn,
          ],
          updatedAt: Date.now(),
        };
      }),
    );

    let shouldClearComposer = false;

    setStreamingTurnId(assistantTurn.id);
    streamedTextRef.current = "";
    stickToBottomRef.current = true;

    let completedText = "";

    try {
      const returnedText = await streamChat(
        messages,
        activeModelName,
        (token: string) => {
          streamedTextRef.current += token;
          queueStreamPaint();
        },
      );

      completedText =
        (typeof returnedText === "string"
          ? returnedText.trim()
          : "") ||
        streamedTextRef.current.trim() ||
        "No response returned.";

      shouldClearComposer = true;
    } catch (sendError) {
      const errorMessage =
        sendError instanceof Error
          ? sendError.message
          : "Could not connect to the local assistant.";

      completedText =
        errorMessage === "Generation canceled."
          ? "Generation canceled."
          : `Error: ${errorMessage}`;
    } finally {
      if (streamFrameRef.current !== null) {
        window.cancelAnimationFrame(
          streamFrameRef.current,
        );

        streamFrameRef.current = null;
      }

      updateTurnContent(
        sessionId,
        assistantTurn.id,
        completedText,
      );

      if (shouldClearComposer) {
        setMessage("");
        setAttachedFiles([]);

        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }

      streamedTextRef.current = "";
      setStreamingTurnId(null);
      setIsCanceling(false);
    }
  }

  async function regenerateResponse(assistantTurnId: string) {
    if (isGenerating || isCanceling || !activeSession || !activeModelName) {
      return;
    }

    const turns = activeSession.turns;
    const assistantTurnIndex = turns.findIndex(
      (t) => t.id === assistantTurnId,
    );

    if (assistantTurnIndex < 1) return;

    const userTurn = turns[assistantTurnIndex - 1];
    if (!userTurn || userTurn.role !== "user") return;

    const sessionId = activeSession.id;
    const historyTurns = turns.slice(0, assistantTurnIndex - 1);

    const modelPrompt = buildPrompt(
      userTurn.content,
      userTurn.files ?? [],
    );

    const messages = buildMessages(
      historyTurns,
      modelPrompt,
      preset,
      answerLength,
      citationMode,
    );

    updateTurnContent(sessionId, assistantTurnId, "Thinking...");
    setStreamingTurnId(assistantTurnId);
    streamedTextRef.current = "";
    stickToBottomRef.current = true;

    let completedText = "";

    try {
      const returnedText = await streamChat(
        messages,
        activeModelName,
        (token: string) => {
          streamedTextRef.current += token;
          queueStreamPaint();
        },
      );

      completedText =
        (typeof returnedText === "string"
          ? returnedText.trim()
          : "") ||
        streamedTextRef.current.trim() ||
        "No response returned.";
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "Could not connect to the local assistant.";

      completedText =
        errorMessage === "Generation canceled."
          ? "Generation canceled."
          : `Error: ${errorMessage}`;
    } finally {
      if (streamFrameRef.current !== null) {
        window.cancelAnimationFrame(streamFrameRef.current);
        streamFrameRef.current = null;
      }

      updateTurnContent(sessionId, assistantTurnId, completedText);
      streamedTextRef.current = "";
      setStreamingTurnId(null);
      setIsCanceling(false);
    }
  }

  function startEditTurn(turnId: string) {
    if (!activeSession) return;
    const turn = activeSession.turns.find((t) => t.id === turnId);
    if (!turn || turn.role !== "user") return;

    setDraftTurnContent(turn.content);
    setEditingTurnId(turnId);

    window.requestAnimationFrame(() => {
      editTurnRef.current?.focus();
    });
  }

  async function commitEditAndResend() {
    const trimmed = draftTurnContent.trim();

    if (!editingTurnId || !trimmed) {
      setEditingTurnId(null);
      return;
    }

    if (isGenerating || isCanceling || !activeSession || !activeModelName) {
      return;
    }

    const turns = activeSession.turns;
    const userTurnIndex = turns.findIndex((t) => t.id === editingTurnId);

    if (userTurnIndex === -1) return;

    const userTurn = turns[userTurnIndex];
    const sessionId = activeSession.id;
    const historyTurns = turns.slice(0, userTurnIndex);

    const updatedUserTurn: ChatTurn = {
      ...userTurn,
      content: trimmed,
    };

    const newAssistantId = createId("assistant");
    const newAssistantTurn: ChatTurn = {
      id: newAssistantId,
      role: "assistant",
      content: "Thinking...",
    };

    setSessions((current) =>
      current.map((session) => {
        if (session.id !== sessionId) return session;
        return {
          ...session,
          turns: [...historyTurns, updatedUserTurn, newAssistantTurn],
          updatedAt: Date.now(),
        };
      }),
    );

    setEditingTurnId(null);

    const modelPrompt = buildPrompt(trimmed, userTurn.files ?? []);
    const messages = buildMessages(
      historyTurns,
      modelPrompt,
      preset,
      answerLength,
      citationMode,
    );

    setStreamingTurnId(newAssistantId);
    streamedTextRef.current = "";
    stickToBottomRef.current = true;

    let completedText = "";

    try {
      const returnedText = await streamChat(
        messages,
        activeModelName,
        (token: string) => {
          streamedTextRef.current += token;
          queueStreamPaint();
        },
      );

      completedText =
        (typeof returnedText === "string"
          ? returnedText.trim()
          : "") ||
        streamedTextRef.current.trim() ||
        "No response returned.";
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "Could not connect to the local assistant.";

      completedText =
        errorMessage === "Generation canceled."
          ? "Generation canceled."
          : `Error: ${errorMessage}`;
    } finally {
      if (streamFrameRef.current !== null) {
        window.cancelAnimationFrame(streamFrameRef.current);
        streamFrameRef.current = null;
      }

      updateTurnContent(sessionId, newAssistantId, completedText);
      streamedTextRef.current = "";
      setStreamingTurnId(null);
      setIsCanceling(false);
    }
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void sendMessage();
    }
  }

  function handleResponseScroll() {
    const responseLog = responseLogRef.current;
    if (!responseLog) return;

    const distanceFromBottom =
      responseLog.scrollHeight -
      responseLog.scrollTop -
      responseLog.clientHeight;

    stickToBottomRef.current =
      distanceFromBottom < 80;
  }

  function handleDragEnter(
    event: DragEvent<HTMLElement>,
  ) {
    event.preventDefault();

    dragDepthRef.current += 1;
    setIsDragging(true);
  }

  function handleDragOver(
    event: DragEvent<HTMLElement>,
  ) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(
    event: DragEvent<HTMLElement>,
  ) {
    event.preventDefault();

    dragDepthRef.current = Math.max(
      0,
      dragDepthRef.current - 1,
    );

    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();

    dragDepthRef.current = 0;
    setIsDragging(false);

    void addFiles(event.dataTransfer.files);
  }

  return (
    <main
      className={`app-shell theme-${theme}${
        isSidebarCollapsed ? " sidebar-collapsed" : ""
      }${
        isDragging ? " dragging" : ""
      }`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging ? (
        <div
          className="drag-overlay"
          aria-hidden="true"
        >
          <div className="drag-overlay-panel">
            <strong>Drop file here</strong>
            <span>Release to attach your file</span>
          </div>
        </div>
      ) : null}

      <aside
        className={`sidebar${
          isSidebarCollapsed ? " collapsed" : ""
        }`}
      >
        <div className="sidebar-header">
          <div className="sidebar-header-bar">
            <button
              type="button"
              className="sidebar-collapse-button"
              onClick={() =>
                setIsSidebarCollapsed((current) => !current)
              }
              aria-pressed={isSidebarCollapsed}
              aria-label={
                isSidebarCollapsed
                  ? "Expand sidebar"
                  : "Collapse sidebar"
              }
            >
              <CollapseIcon
                className={`ui-icon${
                  isSidebarCollapsed ? " is-collapsed" : ""
                }`}
              />
            </button>

            <button
              type="button"
              className="sidebar-new-button"
              onClick={createNewChat}
              aria-label="Create new chat"
            >
              <NewChatIcon className="ui-icon" />
            </button>
          </div>

          <h2>Recent chats</h2>

          {collapsedPreviewSessions.length ? (
            <div
              className="sidebar-collapsed-list"
              aria-hidden={!isSidebarCollapsed}
            >
              {collapsedPreviewSessions.map((session, index) => (
                <button
                  key={session.id}
                  type="button"
                  className={
                    session.id === activeSession.id
                      ? "sidebar-collapsed-item active"
                      : "sidebar-collapsed-item"
                  }
                  onClick={() => selectSession(session.id)}
                  aria-label={`Open recent chat ${index + 1}`}
                >
                  <span aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div
          className="history-list"
          role="list"
          aria-label="Previous chat history"
        >
          {historySections.map((section) => (
            <section key={section.label} className="history-group">
              <h3 className="history-group-label">{section.label}</h3>

              <div className="history-group-items">
                {section.sessions.map((session) => (
                  <div
                    key={session.id}
                    className={
                      session.id === activeSession.id
                        ? "history-item-shell active"
                        : "history-item-shell"
                    }
                    onContextMenu={(event) => {
                      event.preventDefault();

                      openHistoryMenu(
                        session.id,
                        event.clientX,
                        event.clientY,
                      );
                    }}
                  >
                    {editingSessionId === session.id ? (
                      <input
                        className="history-rename-input"
                        value={draftTitle}
                        autoFocus
                        onPointerDown={(event) =>
                          event.stopPropagation()
                        }
                        onChange={(event) =>
                          setDraftTitle(
                            event.currentTarget.value,
                          )
                        }
                        onBlur={commitRename}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.currentTarget.blur();
                          }

                          if (event.key === "Escape") {
                            setEditingSessionId(null);
                          }
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="history-item"
                        onClick={() =>
                          selectSession(session.id)
                        }
                        onDoubleClick={() =>
                          startRename(session.id)
                        }
                        aria-pressed={
                          session.id === activeSession.id
                        }
                      >
                        <span className="history-item-title">
                          {session.title}
                        </span>
                      </button>
                    )}

                    <button
                      type="button"
                      className="history-options-button"
                      aria-label={`More options for ${session.title}`}
                      onClick={(event) => {
                        event.stopPropagation();

                        const rect =
                          event.currentTarget.getBoundingClientRect();

                        openHistoryMenu(
                          session.id,
                          rect.right - 164,
                          rect.bottom + 6,
                        );
                      }}
                    >
                      <MoreIcon className="ui-icon" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </aside>

      {historyMenu ? (
        <div
          className="history-menu"
          style={{
            left: historyMenu.x,
            top: historyMenu.y,
          }}
          role="menu"
          onPointerDown={(event) =>
            event.stopPropagation()
          }
        >
          <button
            type="button"
            className="history-menu-item"
            onClick={() =>
              startRename(historyMenu.sessionId)
            }
          >
            Rename
          </button>

          <button
            type="button"
            className="history-menu-item"
            onClick={() =>
              duplicateSession(historyMenu.sessionId)
            }
          >
            Duplicate
          </button>

          <button
            type="button"
            className="history-menu-item danger"
            onClick={() =>
              deleteSession(historyMenu.sessionId)
            }
          >
            Delete
          </button>
        </div>
      ) : null}

      <section className="workspace">
        <header className="workspace-header">
          <div className="header-actions">
            <div className="header-toolbar">
              <div className="model-select-shell">
                <span className="toolbar-label">Model</span>

                <button
                  type="button"
                  className="model-select-trigger"
                  aria-label="Select model"
                  aria-haspopup="listbox"
                  aria-expanded={isModelMenuOpen}
                  title={activeModelName || "No models found"}
                  disabled={!availableModelNames.length || isGenerating}
                  onClick={() =>
                    setIsModelMenuOpen((current) => !current)
                  }
                >
                  <span className="model-select-value">
                    {activeModelName
                      ? getModelDisplayName(activeModelName)
                      : "No models found"}
                  </span>
                </button>

                {isModelMenuOpen && availableModelNames.length ? (
                  <div
                    className="model-select-menu"
                    role="listbox"
                    aria-label="Available models"
                    onPointerDown={(event) =>
                      event.stopPropagation()
                    }
                  >
                    {availableModelNames.map((modelName) => (
                      <button
                        key={modelName}
                        type="button"
                        role="option"
                        aria-selected={modelName === activeModelName}
                        className={`model-select-option${
                          modelName === activeModelName
                            ? " active"
                            : ""
                        }`}
                        onClick={() => {
                          setSelectedModelName(modelName);
                          setIsModelMenuOpen(false);
                        }}
                      >
                        <span>{getModelDisplayName(modelName)}</span>
                        <small>{modelName}</small>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                className="theme-toggle"
                onClick={() =>
                  setTheme((current) =>
                    current === "dark"
                      ? "light"
                      : "dark",
                  )
                }
                aria-pressed={theme === "light"}
              >
                <ThemeIcon className="ui-icon" theme={theme} />
                <span>{theme === "dark" ? "Light" : "Dark"}</span>
              </button>
            </div>
          </div>

          {error ? (
            <div className="ollama-error-banner" role="alert">
              <span>Error: {error}</span>
            </div>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".txt,.md,text/plain,text/markdown"
            onChange={(event) => {
              void addFiles(
                event.currentTarget.files ?? [],
              );

              event.currentTarget.value = "";
            }}
            className="file-input"
            aria-hidden="true"
            tabIndex={-1}
          />
        </header>

        <section className="card chat-canvas">
          {activeSession.turns.length === 0 ? (
            <div className="canvas-greeting">
              <h3>{emptyStateContent.title}</h3>

              <p>{emptyStateContent.description}</p>

              {emptyStateContent.prompts.length ? (
                <div className="starter-prompts" role="group" aria-label="Starter prompts">
                  {emptyStateContent.prompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="starter-prompt-button"
                      onClick={() => applyStarterPrompt(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="active-chat-heading">
              <span>{activeSession.title}</span>

              {isGenerating ? (
                <small>Generating response…</small>
              ) : null}
            </div>
          )}

          <div className="response-panel">
            {isGenerating ? (
              <div className="response-loading-banner">
                <span className="loading-indicator" aria-live="polite">
                  Generating response…
                </span>
              </div>
            ) : null}

            <div
              ref={responseLogRef}
              className="response-log"
              onScroll={handleResponseScroll}
            >
              {activeSession.turns.length ? (
                activeSession.turns.map((turn) => {
                  const isStreamingTurn =
                    turn.id === streamingTurnId;
                  const isEditingThisTurn =
                    editingTurnId === turn.id;

                  return (
                    <div
                      key={turn.id}
                      className={`turn turn-${turn.role}${
                        isStreamingTurn ? " streaming" : ""
                      }${isEditingThisTurn ? " editing" : ""}`}
                    >
                      {turn.files?.length ? (
                        <div className="message-attachments">
                          {turn.files.map((file) => (
                            <div
                              key={file.id}
                              className="message-attachment"
                            >
                              <strong>
                                {file.name}
                              </strong>

                              <span>
                                {file.typeLabel} ·{" "}
                                {file.sizeLabel}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {isEditingThisTurn ? (
                        <div className="turn-edit-shell">
                          <textarea
                            ref={editTurnRef}
                            className="turn-edit-box"
                            value={draftTurnContent}
                            rows={3}
                            onChange={(event) =>
                              setDraftTurnContent(
                                event.currentTarget.value,
                              )
                            }
                            onKeyDown={(event) => {
                              if (
                                event.key === "Enter" &&
                                !event.shiftKey &&
                                !event.nativeEvent.isComposing
                              ) {
                                event.preventDefault();
                                void commitEditAndResend();
                              }
                              if (event.key === "Escape") {
                                setEditingTurnId(null);
                              }
                            }}
                          />
                          <div className="turn-edit-actions">
                            <button
                              type="button"
                              className="turn-edit-cancel"
                              onClick={() => setEditingTurnId(null)}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="turn-edit-send"
                              disabled={!draftTurnContent.trim()}
                              onClick={() => void commitEditAndResend()}
                            >
                              Resend
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p
                          ref={
                            isStreamingTurn
                              ? streamingTextElementRef
                              : undefined
                          }
                        >
                          {turn.content}
                        </p>
                      )}

                      {!isStreamingTurn && !isEditingThisTurn && !isGenerating ? (
                        <div className="turn-actions">
                          {turn.role === "user" ? (
                            <button
                              type="button"
                              className="turn-action-button"
                              aria-label="Edit message"
                              title="Edit and resend"
                              onClick={() => startEditTurn(turn.id)}
                            >
                              <EditIcon className="ui-icon" />
                              <span>Edit</span>
                            </button>
                          ) : null}
                          {turn.role === "assistant" ? (
                            <button
                              type="button"
                              className="turn-action-button"
                              aria-label="Regenerate response"
                              title="Regenerate"
                              onClick={() =>
                                void regenerateResponse(turn.id)
                              }
                            >
                              <RegenerateIcon className="ui-icon" />
                              <span>Regenerate</span>
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <p className="response-empty">
                  Your first message will create a local
                  response.
                </p>
              )}
            </div>
          </div>

          <div className="composer-stack">
            {attachedFiles.length ? (
              <div
                className="pending-attachments"
                aria-label="Files ready to send"
              >
                {attachedFiles.map((file) => (
                  <div
                    key={file.id}
                    className="pending-attachment"
                  >
                    <div className="pending-file-details">
                      <strong>{file.name}</strong>
                      <span>{file.sizeLabel}</span>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        removeFile(file.id)
                      }
                      aria-label={`Remove ${file.name}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="composer-controls">
              <div
                className="length-controls"
                role="group"
                aria-label="Response length"
              >
                {(["short", "medium", "long"] as AnswerLength[]).map(
                  (len) => (
                    <button
                      key={len}
                      type="button"
                      className={`length-button${
                        answerLength === len ? " active" : ""
                      }`}
                      aria-pressed={answerLength === len}
                      disabled={isGenerating}
                      onClick={() => setAnswerLength(len)}
                    >
                      {len.charAt(0).toUpperCase() + len.slice(1)}
                    </button>
                  ),
                )}
              </div>

              <button
                type="button"
                className={`citation-toggle${
                  citationMode ? " active" : ""
                }`}
                aria-pressed={citationMode}
                disabled={isGenerating}
                title={
                  citationMode
                    ? "Citations on — click to disable"
                    : "Citations off — click to enable"
                }
                onClick={() => setCitationMode((c) => !c)}
              >
                <CitationsIcon className="ui-icon" />
                <span>Citations</span>
              </button>
            </div>

            <div
              className={`composer-shell${
                isGenerating ? " generating" : ""
              }`}
              aria-label="Message composer"
            >
              <button
                type="button"
                className="attach-button"
                aria-label="Attach file"
                disabled={isGenerating}
                onClick={openFilePicker}
              >
                <AttachIcon className="ui-icon" />
              </button>

              <textarea
                ref={messageRef}
                className="prompt-box"
                placeholder="Message Desktop Spotlight AI"
                rows={1}
                value={message}
                disabled={isGenerating}
                onChange={(event) =>
                  setMessage(event.currentTarget.value)
                }
                onKeyDown={handleKeyDown}
              />

              <button
                type="button"
                className="preset-pill-button"
                disabled={isGenerating}
                aria-label={`Response style: ${selectedPreset.label}`}
                title={selectedPreset.description}
                onClick={cyclePreset}
              >
                {selectedPreset.label}
              </button>

              {isGenerating ? (
                <button
                  type="button"
                  className="cancel-button composer-cancel-button"
                  onClick={() => {
                    setIsCanceling(true);
                    cancelChat();
                  }}
                >
                  Cancel
                </button>
              ) : null}

              <button
                type="button"
                className="send-button"
                aria-label="Send"
                disabled={!canSend}
                onClick={() =>
                  void sendMessage()
                }
              >
                <SendIcon className="ui-icon" />
                <span>{isGenerating ? "Working" : "Send"}</span>
              </button>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

export default App;