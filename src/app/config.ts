export const hardwareProfiles = [
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

export type HardwareProfileId = (typeof hardwareProfiles)[number]["id"];

export const runtimeProfiles = {
  "low-power": {
    previewCharacters: 1200,
    recentMessageCount: 6,
  },
  balanced: {
    previewCharacters: 2500,
    recentMessageCount: 12,
  },
  "high-quality": {
    previewCharacters: 5000,
    recentMessageCount: 18,
  },
  custom: {
    previewCharacters: 7000,
    recentMessageCount: 20,
  },
} satisfies Record<
  HardwareProfileId,
  {
    previewCharacters: number;
    recentMessageCount: number;
  }
>;

export const storageKeys = {
  sessions: "desktop-spotlight-ai-chats-v2",
  activeSession: "desktop-spotlight-ai-active-chat-v2",
  attachments: "desktop-spotlight-ai-attached-files-v2",
  theme: "desktop-spotlight-ai-theme",
  sidebarCollapsed: "desktop-spotlight-ai-sidebar-collapsed",
  selectedModel: "desktop-spotlight-ai-selected-model-v3",
  hardwareProfile: "desktop-spotlight-ai-hardware-profile",
  ollamaEndpoint: "desktop-spotlight-ai-ollama-endpoint",
} as const;

export const composerLayout = {
  lineHeight: 18,
  maxLines: 10,
  verticalPadding: 10,
} as const;

export const maxMessageHeight =
  composerLayout.lineHeight * composerLayout.maxLines +
  composerLayout.verticalPadding;

export const folderInputAttributes = {
  webkitdirectory: "",
  directory: "",
} as const;
