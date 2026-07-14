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

const hardwareProfiles = [
  {
    id: "low-power",
    label: "Low Power",
    description: "Smaller local models and shorter previews for limited hardware.",
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Default profile for everyday local analysis and chat.",
  },
  {
    id: "high-quality",
    label: "High Quality",
    description: "Stronger local models and longer context on capable machines.",
  },
  {
    id: "custom",
    label: "Custom",
    description: "Manual local setup for advanced users and non-default endpoints.",
  },
] as const;

const runtimeProfiles = {
  "low-power": {
    previewCharacters: 1200,
    recentMessageCount: 6,
    systemNote:
      "Optimize for smaller local models. Keep context tight, prefer shorter answers, and avoid unnecessary elaboration.",
  },
  balanced: {
    previewCharacters: 2500,
    recentMessageCount: 12,
    systemNote:
      "Balance context size with responsiveness for normal local desktop use.",
  },
  "high-quality": {
    previewCharacters: 5000,
    recentMessageCount: 18,
    systemNote:
      "Use the fuller available context and provide more complete reasoning when it helps the user.",
  },
  custom: {
    previewCharacters: 7000,
    recentMessageCount: 20,
    systemNote:
      "The user selected a custom local setup. Use the broader available context, but stay grounded in the supplied files and chat history.",
  },
} satisfies Record<
  HardwareProfileId,
  {
    previewCharacters: number;
    recentMessageCount: number;
    systemNote: string;
  }
>;

type PresetId = (typeof presets)[number]["id"];
type HardwareProfileId = (typeof hardwareProfiles)[number]["id"];
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

type RegenerateTarget = {
  userTurn: ChatTurn;
  assistantTurn: ChatTurn;
  historyBeforeUserTurn: ChatTurn[];
};

type OllamaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

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
const hardwareProfileStorageKey =
  "desktop-spotlight-ai-hardware-profile";
const ollamaEndpointStorageKey =
  "desktop-spotlight-ai-ollama-endpoint";

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

function getInitialHardwareProfile(): HardwareProfileId {
  try {
    const stored = localStorage.getItem(hardwareProfileStorageKey);

    if (
      stored &&
      hardwareProfiles.some((profile) => profile.id === stored)
    ) {
      return stored as HardwareProfileId;
    }
  } catch {
    // Ignore localStorage access failures and fall back to default.
  }

  return "balanced";
}

function getInitialOllamaEndpoint() {
  try {
    return (
      localStorage.getItem(ollamaEndpointStorageKey) ??
      "http://127.0.0.1:11434"
    );
  } catch {
    return "http://127.0.0.1:11434";
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

async function summarizeFile(
  file: File,
  previewCharacterLimit: number,
): Promise<AttachedFile> {
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
      ? text.trim().slice(0, previewCharacterLimit)
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

function SettingsIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M6.6 2.2h2.8l.35 1.52c.35.12.69.27 1 .46l1.42-.67 1.4 2.42-1.06 1.02c.04.19.06.39.06.6s-.02.41-.06.6l1.06 1.02-1.4 2.42-1.42-.67c-.31.19-.65.34-1 .46l-.35 1.52H6.6l-.35-1.52a4.74 4.74 0 0 1-1-.46l-1.42.67-1.4-2.42 1.06-1.02A3.4 3.4 0 0 1 3.43 8c0-.21.02-.41.06-.6L2.43 6.38l1.4-2.42 1.42.67c.31-.19.65-.34 1-.46L6.6 2.2Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
      <circle cx="8" cy="8" r="1.85" fill="none" stroke="currentColor" strokeWidth="1.2" />
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
  session: ChatSession,
  prompt: string,
  preset: PresetId,
  hardwareProfile: HardwareProfileId,
): OllamaMessage[] {
  const runtimeProfile = runtimeProfiles[hardwareProfile];

  const recentMessages: OllamaMessage[] = session.turns
    .filter((turn) => turn.content.trim())
    .slice(-runtimeProfile.recentMessageCount)
    .map((turn) => ({
      role: turn.role,
      content: turn.content,
    }));

  const identityPrompt = `
${presetSystemPrompts[preset]}

The current mode selection is authoritative for this reply.
If earlier messages in this chat used a different tone or depth, ignore that and follow the current mode instead.
${runtimeProfile.systemNote}

You are Desktop Spotlight AI, a local desktop assistant.
Do not claim to be GPT-4, ChatGPT, or an OpenAI model.
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
  const initialOllamaEndpoint = useRef(getInitialOllamaEndpoint());

  const {
    models,
    streamChat,
    isGenerating,
    error,
    refreshModels,
    cancelChat,
  } = useOllama(initialOllamaEndpoint.current);

  const [preset, setPreset] = useState<PresetId>("balanced");
  const [hardwareProfile, setHardwareProfile] = useState<HardwareProfileId>(
    getInitialHardwareProfile,
  );
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    getInitialSidebarCollapsed,
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedModelName, setSelectedModelName] = useState(
    getInitialSelectedModel,
  );
  const [ollamaEndpoint, setOllamaEndpoint] = useState(
    initialOllamaEndpoint.current,
  );
  const [endpointDraft, setEndpointDraft] = useState(
    initialOllamaEndpoint.current,
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
  const [selectedPreviewFileId, setSelectedPreviewFileId] = useState<
    string | null
  >(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<
    "extracted" | "sent"
  >("extracted");

  const [historyMenu, setHistoryMenu] =
    useState<HistoryMenuState | null>(null);

  const [editingSessionId, setEditingSessionId] =
    useState<string | null>(null);

  const [draftTitle, setDraftTitle] = useState("");
  const [streamingTurnId, setStreamingTurnId] =
    useState<string | null>(null);

  const messageRef = useRef<HTMLTextAreaElement>(null);
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

  const selectedHardwareProfile =
    hardwareProfiles.find((profile) => profile.id === hardwareProfile) ??
    hardwareProfiles[1];

  const runtimeProfile = runtimeProfiles[hardwareProfile];

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

  const selectedPreviewFile = useMemo(() => {
    if (!attachedFiles.length) {
      return null;
    }

    return (
      attachedFiles.find(
        (file) => file.id === selectedPreviewFileId,
      ) ?? attachedFiles[0]
    );
  }, [attachedFiles, selectedPreviewFileId]);

  const pendingVisibleContent = attachedFiles.length
    ? message.trim() || `Attached ${attachedFiles.length} file(s).`
    : "";

  const pendingPromptPreview = selectedPreviewFile
    ? buildPrompt(pendingVisibleContent, attachedFiles)
    : "";

  const activePreviewText = selectedPreviewFile
    ? previewMode === "sent"
      ? pendingPromptPreview
      : selectedPreviewFile.preview
    : "";

  const activeSessionHasTurns =
    activeSession.turns.length > 0;

  const regenerateTarget = useMemo<RegenerateTarget | null>(() => {
    for (let index = activeSession.turns.length - 1; index > 0; index -= 1) {
      const assistantTurn = activeSession.turns[index];
      const userTurn = activeSession.turns[index - 1];

      if (
        assistantTurn.role === "assistant" &&
        userTurn.role === "user"
      ) {
        return {
          userTurn,
          assistantTurn,
          historyBeforeUserTurn: activeSession.turns.slice(0, index - 1),
        };
      }
    }

    return null;
  }, [activeSession.turns]);

  const hasDraftMessage =
    message.trim().length > 0;

  const emptyStateContent = useMemo(() => {
    if (attachedFiles.length > 0) {
      return {
        title: "Files attached.",
        description:
          "Ask a question or generate a summary.",
        prompts: [
          "Summarize the attached notes and pull out the key actions.",
          "Review the attached files and tell me what matters most.",
        ],
      };
    }

    if (hasDraftMessage) {
      return {
        title: "Draft in progress.",
        description:
          "Keep writing, attach a file, or send.",
        prompts: [] as string[],
      };
    }

    if (hasSavedChats && activeSessionHasTurns) {
      return {
        title: "Continue.",
        description:
          "Pick up where you left off or start something new.",
        prompts: [
          "Review my last conversation and suggest the next actions.",
          "Draft a follow-up message based on what we already discussed.",
        ],
      };
    }

    return {
      title: "Ready.",
      description:
        "Drop a file or ask a question.",
      prompts: [
        "Summarize the attached notes and pull out the key actions.",
        "Turn this into a clean email draft I can send.",
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

  const canSummarize =
    !isGenerating &&
    Boolean(activeModelName) &&
    attachedFiles.length > 0;

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
    if (!attachedFiles.length) {
      if (selectedPreviewFileId !== null) {
        setSelectedPreviewFileId(null);
      }

      if (isPreviewOpen) {
        setIsPreviewOpen(false);
      }

      return;
    }

    if (
      !selectedPreviewFileId ||
      !attachedFiles.some(
        (file) => file.id === selectedPreviewFileId,
      )
    ) {
      setSelectedPreviewFileId(attachedFiles[0].id);
    }
  }, [attachedFiles, isPreviewOpen, selectedPreviewFileId]);

  useEffect(() => {
    localStorage.setItem(activeChatStorageKey, activeSessionId);
  }, [activeSessionId]);

  useEffect(() => {
    localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(
      hardwareProfileStorageKey,
      hardwareProfile,
    );
  }, [hardwareProfile]);

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
    localStorage.setItem(
      ollamaEndpointStorageKey,
      ollamaEndpoint,
    );
  }, [ollamaEndpoint]);

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
      setIsSettingsOpen(false);
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

  function removeTurn(sessionId: string, turnId: string) {
    setSessions((current) =>
      current.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        return {
          ...session,
          updatedAt: Date.now(),
          turns: session.turns.filter((turn) => turn.id !== turnId),
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
      fileArray.map((file) =>
        summarizeFile(file, runtimeProfile.previewCharacters),
      ),
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

  function applyEndpointSettings() {
    const nextEndpoint = endpointDraft.trim();

    if (!nextEndpoint) {
      setEndpointDraft(ollamaEndpoint);
      return;
    }

    setOllamaEndpoint(nextEndpoint);
  }

  async function runAssistantReply(options: {
    sessionId: string;
    baseTurns: ChatTurn[];
    visibleContent: string;
    filesForTurn: AttachedFile[];
    assistantTurnId?: string;
    userTurnId?: string;
    shouldAppendUserTurn: boolean;
    shouldClearComposerOnSuccess: boolean;
  }) {
    const {
      sessionId,
      baseTurns,
      visibleContent,
      filesForTurn,
      assistantTurnId,
      userTurnId,
      shouldAppendUserTurn,
      shouldClearComposerOnSuccess,
    } = options;

    const modelPrompt = buildPrompt(
      visibleContent,
      filesForTurn,
    );

    const messages = buildMessages(
      {
        ...activeSession,
        id: sessionId,
        turns: baseTurns,
      },
      modelPrompt,
      preset,
      hardwareProfile,
    );

    const now = Date.now();

    const nextUserTurn: ChatTurn = {
      id: userTurnId ?? `user-${now}`,
      role: "user",
      content: visibleContent,
      files: filesForTurn,
    };

    const nextAssistantTurn: ChatTurn = {
      id: assistantTurnId ?? `assistant-${now}`,
      role: "assistant",
      content: "Thinking...",
    };

    const automaticTitle =
      visibleContent.trim() ||
      filesForTurn[0]?.name ||
      "New chat";

    setSessions((current) =>
      current.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        if (shouldAppendUserTurn) {
          return {
            ...session,
            title:
              session.title === "New chat"
                ? automaticTitle.slice(0, 42)
                : session.title,
            turns: [
              ...session.turns,
              nextUserTurn,
              nextAssistantTurn,
            ],
            updatedAt: Date.now(),
          };
        }

        return {
          ...session,
          turns: session.turns.map((turn) =>
            turn.id === nextAssistantTurn.id
              ? {
                  ...turn,
                  content: "Thinking...",
                }
              : turn,
          ),
          updatedAt: Date.now(),
        };
      }),
    );

    let shouldClearComposer = false;

    setStreamingTurnId(nextAssistantTurn.id);
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

      shouldClearComposer = shouldClearComposerOnSuccess;
    } catch (sendError) {
      const errorMessage =
        sendError instanceof Error
          ? sendError.message
          : "Could not connect to the local assistant.";

      if (errorMessage === "Generation canceled.") {
        completedText = streamedTextRef.current.trim();
      } else {
        completedText = `Error: ${errorMessage}`;
      }
    } finally {
      if (streamFrameRef.current !== null) {
        window.cancelAnimationFrame(
          streamFrameRef.current,
        );

        streamFrameRef.current = null;
      }

      if (completedText) {
        updateTurnContent(
          sessionId,
          nextAssistantTurn.id,
          completedText,
        );
      } else {
        removeTurn(sessionId, nextAssistantTurn.id);
      }

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

    const filesForTurn = attachedFiles;

    const visibleContent = summarize
      ? trimmedMessage
        ? `Please summarize the attached file(s) and answer: ${trimmedMessage}`
        : "Please summarize the attached file(s)."
      : trimmedMessage ||
        `Attached ${filesForTurn.length} file(s).`;

    setAttachedFiles([]);
    setSelectedPreviewFileId(null);
    setIsPreviewOpen(false);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    await runAssistantReply({
      sessionId: activeSession.id,
      baseTurns: activeSession.turns,
      visibleContent,
      filesForTurn,
      shouldAppendUserTurn: true,
      shouldClearComposerOnSuccess: true,
    });
  }

  async function regenerateLastResponse() {
    if (
      isGenerating ||
      isCanceling ||
      !activeModelName ||
      !regenerateTarget
    ) {
      return;
    }

    await runAssistantReply({
      sessionId: activeSession.id,
      baseTurns: regenerateTarget.historyBeforeUserTurn,
      visibleContent: regenerateTarget.userTurn.content,
      filesForTurn: regenerateTarget.userTurn.files ?? [],
      assistantTurnId: regenerateTarget.assistantTurn.id,
      shouldAppendUserTurn: false,
      shouldClearComposerOnSuccess: false,
    });
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

  const setupStatusLabel = error
    ? error
    : availableModelNames.length
      ? `${availableModelNames.length} model${availableModelNames.length === 1 ? "" : "s"} available.`
      : "No models found yet. Install or pull a local model to continue.";

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

        <div className="sidebar-footer">
          <button
            type="button"
            className="sidebar-settings-button"
            aria-pressed={isSettingsOpen}
            aria-label={isSettingsOpen ? "Open chat" : "Open settings"}
            onClick={() =>
              setIsSettingsOpen((current) => !current)
            }
          >
            <SettingsIcon className="ui-icon" />
            <span>{isSettingsOpen ? "Back to chat" : "Settings"}</span>
          </button>
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

        {isSettingsOpen ? (
          <section className="card settings-card">
            <div className="settings-header">
              <div>
                <h3>Settings</h3>
                <p>
                  Configure the local model connection and choose the device profile for this app.
                </p>
              </div>

              <button
                type="button"
                className="settings-close-button"
                onClick={() => setIsSettingsOpen(false)}
              >
                Back to chat
              </button>
            </div>

            <div className="settings-grid">
              <section className="settings-panel">
                <div className="settings-panel-header">
                  <h4>Local AI</h4>
                  <p>{setupStatusLabel}</p>
                </div>

                <label className="settings-field">
                  <span>Ollama endpoint</span>
                  <div className="settings-input-row">
                    <input
                      className="settings-input"
                      type="text"
                      value={endpointDraft}
                      onChange={(event) =>
                        setEndpointDraft(event.currentTarget.value)
                      }
                      placeholder="http://127.0.0.1:11434"
                    />

                    <button
                      type="button"
                      className="settings-apply-button"
                      onClick={applyEndpointSettings}
                    >
                      Apply
                    </button>
                  </div>
                </label>

                <label className="settings-field">
                  <span>Model</span>
                  <select
                    className="settings-select"
                    value={activeModelName}
                    disabled={!availableModelNames.length || isGenerating}
                    onChange={(event) =>
                      setSelectedModelName(event.currentTarget.value)
                    }
                  >
                    {availableModelNames.length ? (
                      availableModelNames.map((modelName) => (
                        <option key={modelName} value={modelName}>
                          {modelName}
                        </option>
                      ))
                    ) : (
                      <option value="">No models found</option>
                    )}
                  </select>
                </label>

                <div className="settings-actions">
                  <button
                    type="button"
                    className="settings-secondary-button"
                    onClick={() => {
                      void refreshModels();
                    }}
                  >
                    Retry connection
                  </button>

                  <p className="settings-note">
                    Local processing stays on this device unless you add online features later.
                  </p>
                </div>
              </section>

              <section className="settings-panel">
                <div className="settings-panel-header">
                  <h4>Device profile</h4>
                  <p>
                    Each profile changes how much file content and chat history are sent to the local model.
                  </p>
                </div>

                <div className="settings-profile-list" role="radiogroup" aria-label="Hardware profile">
                  {hardwareProfiles.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      className={`settings-profile-card${profile.id === hardwareProfile ? " active" : ""}`}
                      aria-pressed={profile.id === hardwareProfile}
                      onClick={() => setHardwareProfile(profile.id)}
                    >
                      <strong>{profile.label}</strong>
                      <span>{profile.description}</span>
                    </button>
                  ))}
                </div>

                <label className="settings-field">
                  <span>Theme</span>
                  <select
                    className="settings-select"
                    value={theme}
                    onChange={(event) =>
                      setTheme(event.currentTarget.value as Theme)
                    }
                  >
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </label>

                <div className="settings-summary">
                  <strong>{selectedHardwareProfile.label}</strong>
                  <span>{selectedHardwareProfile.description}</span>
                  <small>
                    Sends up to {runtimeProfile.previewCharacters.toLocaleString()} file characters and {runtimeProfile.recentMessageCount} recent messages. Response style still uses {selectedPreset.label}.
                  </small>
                </div>
              </section>
            </div>
          </section>
        ) : (
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
              <span>Conversation</span>

              {isGenerating ? (
                <small>Generating</small>
              ) : null}
            </div>
          )}

          {selectedPreviewFile ? (
            <section
              className={`file-preview-panel${
                isPreviewOpen ? " open" : ""
              }`}
              aria-label="Attached file preview"
            >
              <div className="file-preview-header">
                <button
                  type="button"
                  className="file-preview-toggle"
                  aria-expanded={isPreviewOpen}
                  onClick={() =>
                    setIsPreviewOpen((current) => !current)
                  }
                >
                  <span className="file-preview-toggle-copy">
                    <small>{selectedPreviewFile.name}</small>
                  </span>

                  <span className="file-preview-toggle-action">
                    {isPreviewOpen ? "Hide preview" : "Preview"}
                  </span>
                </button>
              </div>

              {isPreviewOpen ? (
                <>
                  {attachedFiles.length > 1 ? (
                    <div
                      className="file-preview-tabs"
                      role="tablist"
                      aria-label="Attached files"
                    >
                      {attachedFiles.map((file) => (
                        <button
                          key={file.id}
                          type="button"
                          role="tab"
                          aria-selected={file.id === selectedPreviewFile.id}
                          className={`file-preview-tab${
                            file.id === selectedPreviewFile.id
                              ? " active"
                              : ""
                          }`}
                          onClick={() =>
                            setSelectedPreviewFileId(file.id)
                          }
                        >
                          <strong>{file.name}</strong>
                          <span>{file.sizeLabel}</span>
                        </button>
                      ))}
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
                          previewMode === "extracted"
                            ? " active"
                            : ""
                        }`}
                        onClick={() => setPreviewMode("extracted")}
                      >
                        Extracted
                      </button>

                      <button
                        type="button"
                        role="tab"
                        aria-selected={previewMode === "sent"}
                        className={`file-preview-mode-button${
                          previewMode === "sent"
                            ? " active"
                            : ""
                        }`}
                        onClick={() => setPreviewMode("sent")}
                      >
                        Sent to model
                      </button>
                    </div>

                    <span className="file-preview-status">
                      {previewMode === "sent"
                        ? "Current draft plus attached file context"
                        : selectedPreviewFile.supported
                          ? "Ready for local analysis"
                          : "Preview unavailable for this file type"}
                    </span>
                  </div>

                  <pre
                    className={`file-preview-text${
                      previewMode === "sent"
                        ? " prompt-preview-text"
                        : ""
                    }`}
                  >
                    {activePreviewText}
                  </pre>
                </>
              ) : null}
            </section>
          ) : null}

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
                  const canRegenerateTurn =
                    turn.role === "assistant" &&
                    regenerateTarget?.assistantTurn.id === turn.id;

                  return (
                    <div
                      key={turn.id}
                      className={`turn turn-${turn.role}${
                        isStreamingTurn
                          ? " streaming"
                          : ""
                      }`}
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

                      <p
                        ref={
                          isStreamingTurn
                            ? streamingTextElementRef
                            : undefined
                        }
                      >
                        {turn.content}
                      </p>

                      {canRegenerateTurn ? (
                        <div className="turn-actions">
                          <button
                            type="button"
                            className="turn-action-button"
                            disabled={isGenerating || !activeModelName}
                            onClick={() => {
                              void regenerateLastResponse();
                            }}
                          >
                            Regenerate
                          </button>
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

              {attachedFiles.length ? (
                <button
                  type="button"
                  className="summarize-action-button composer-summarize-button"
                  disabled={!canSummarize}
                  onClick={() => {
                    void sendMessage(true);
                  }}
                >
                  Summarize
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
        )}
      </section>
    </main>
  );
}

export default App;