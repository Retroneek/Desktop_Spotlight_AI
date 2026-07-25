export type FolderStats = {
  rootName: string;
  filesFound: number;
  filesIncluded: number;
  filesIgnored: number;
  filesSkipped: number;
  totalBytes: number;
  totalCharacters: number;
};

export type SkippedFolderFile = {
  path: string;
  reason: "ignored" | "too-large" | "unsupported" | "context-limit";
};

export type ContextAttachment = {
  id: string;
  kind: "file" | "folder";
  name: string;
  typeLabel: string;
  sizeLabel: string;
  preview: string;
  supported: boolean;
  folderStats?: FolderStats;
  skippedFiles?: SkippedFolderFile[];
};

export type ProjectFolderFile = {
  path: string;
  size: number;
  contents: string;
};

export type ProjectFolderScan = {
  rootName: string;
  filesFound: number;
  filesIncluded: number;
  filesIgnored: number;
  filesSkipped: number;
  totalBytes: number;
  totalCharacters: number;
  includedFiles: ProjectFolderFile[];
  skippedFiles: SkippedFolderFile[];
  tree: string;
};

const maxFolderFileSize = 200 * 1024;
const maxFolderIncludedFiles = 30;
const maxFolderContextCharacters = 12_000;
const maxFolderFileCharacters = 1_800;

const ignoredFolderSegments = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "target",
  ".cache",
  ".next",
  ".vite",
]);

const ignoredFolderFiles = new Set([
  ".ds_store",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "cargo.lock",
]);

const supportedProjectExtensions = new Set([
  ".md",
  ".txt",
  ".json",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".css",
  ".html",
  ".rs",
  ".toml",
]);

const supportedProjectFileNames = new Set([
  ".env.example",
  ".gitignore",
  "package.json",
  "readme.md",
]);

type FolderTreeNode = {
  children: Map<string, FolderTreeNode>;
  isFile: boolean;
};

function createFolderTreeNode(): FolderTreeNode {
  return {
    children: new Map(),
    isFile: false,
  };
}

function getPathSegments(path: string) {
  return path.split("/").filter(Boolean);
}

function getBaseName(path: string) {
  return getPathSegments(path).pop() ?? path;
}

function getProjectFileExtension(path: string) {
  const baseName = getBaseName(path).toLowerCase();
  const dotIndex = baseName.lastIndexOf(".");

  return dotIndex === -1 ? "" : baseName.slice(dotIndex);
}

function isIgnoredProjectPath(path: string) {
  const segments = getPathSegments(path.toLowerCase());
  const fileName = segments[segments.length - 1] ?? "";

  return (
    ignoredFolderFiles.has(fileName) ||
    segments.some((segment) => ignoredFolderSegments.has(segment))
  );
}

function isSupportedProjectFile(path: string) {
  const baseName = getBaseName(path).toLowerCase();

  if (baseName === ".env") {
    return false;
  }

  return (
    supportedProjectFileNames.has(baseName) ||
    supportedProjectExtensions.has(getProjectFileExtension(path))
  );
}

function getProjectFilePriority(path: string) {
  const normalizedPath = path.toLowerCase();
  const baseName = getBaseName(normalizedPath);

  if (baseName === "readme.md") return 0;
  if (baseName === "package.json") return 1;
  if (normalizedPath.endsWith("src/app.tsx")) return 2;
  if (normalizedPath.endsWith("src/services/ollama.tsx")) return 3;
  if (normalizedPath.endsWith("src/services/contextbuilder.ts")) return 4;
  if (normalizedPath.endsWith("src/app.css")) return 5;
  if (normalizedPath.endsWith("src-tauri/src/lib.rs")) return 6;
  if (normalizedPath.endsWith("src-tauri/src/commands/files.rs")) return 7;
  if (normalizedPath.endsWith("src-tauri/tauri.conf.json")) return 8;
  if (normalizedPath.includes("/src/")) return 20;
  if (normalizedPath.includes("/src-tauri/")) return 30;
  if (baseName.endsWith(".json")) return 60;

  return 40;
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

function cleanExtractedText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function truncateContext(text: string, limit: number) {
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit)}\n\n[Context truncated at ${limit.toLocaleString()} characters]`;
}

export function formatFileTree(paths: string[], rootName: string) {
  const root = createFolderTreeNode();
  const maxTreeEntries = 80;
  const sortedPaths = [...paths].sort((left, right) =>
    left.localeCompare(right),
  );
  const lines = [`${rootName}/`];

  for (const path of sortedPaths.slice(0, maxTreeEntries)) {
    const segments = getPathSegments(path);

    if (segments[0] === rootName) {
      segments.shift();
    }

    let currentNode = root;

    segments.forEach((segment, index) => {
      if (!currentNode.children.has(segment)) {
        currentNode.children.set(segment, createFolderTreeNode());
      }

      currentNode = currentNode.children.get(segment)!;
      currentNode.isFile = index === segments.length - 1;
    });
  }

  function walk(node: FolderTreeNode, prefix: string) {
    const entries = [...node.children.entries()].sort(
      ([leftName, leftNode], [rightName, rightNode]) => {
        if (leftNode.isFile !== rightNode.isFile) {
          return leftNode.isFile ? 1 : -1;
        }

        return leftName.localeCompare(rightName);
      },
    );

    entries.forEach(([name, child], index) => {
      const isLast = index === entries.length - 1;
      const branch = isLast ? "└─ " : "├─ ";
      const nextPrefix = `${prefix}${isLast ? "   " : "│  "}`;

      lines.push(`${prefix}${branch}${name}${child.isFile ? "" : "/"}`);

      if (!child.isFile) {
        walk(child, nextPrefix);
      }
    });
  }

  walk(root, "");

  if (lines.length === 1) {
    lines.push("└─ No supported project files included");
  }

  if (sortedPaths.length > maxTreeEntries) {
    lines.push(`└─ ... ${sortedPaths.length - maxTreeEntries} more files`);
  }

  return lines.join("\n");
}

export function buildFileContext(file: ContextAttachment) {
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
}

export function buildFolderContext(folder: ContextAttachment) {
  const folderText = folder.supported
    ? folder.preview
    : "No supported project files were included.";
  const includedPaths = getIncludedPathsFromPreview(folder.preview);

  return [
    `Project folder label: ${folder.name}`,
    "Note: the folder label is only an identifier. Do not infer the app's purpose from the label alone.",
    `Type: ${folder.typeLabel}`,
    `Scan: ${folder.sizeLabel}`,
    includedPaths.length
      ? `Included files:\n${includedPaths.map((path) => `- ${path}`).join("\n")}`
      : "",
    "Context:",
    truncateContext(folderText, maxFolderContextCharacters),
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildCompactFolderContext(folder: ContextAttachment) {
  const stats = folder.folderStats;
  const skippedFiles = folder.skippedFiles ?? [];
  const skippedPreview = skippedFiles
    .filter((file) => file.reason !== "ignored")
    .slice(0, 12)
    .map((file) => `- ${file.path}: ${file.reason}`)
    .join("\n");
  const treeMatch = folder.preview.match(
    /Tree:\n([\s\S]*?)(?:\n\nSkipped files:|\n\nProject context:|$)/,
  );
  const tree = treeMatch?.[1]?.trim();

  return [
    `Project folder label: ${folder.name}`,
    "Note: the folder label is only an identifier. Do not infer the app's purpose from the label alone.",
    stats
      ? `Scan: ${stats.filesFound} found, ${stats.filesIncluded} included, ${stats.filesIgnored} ignored, ${stats.filesSkipped} skipped`
      : `Scan: ${folder.sizeLabel}`,
    "Ignore policy: node_modules, .git, dist, build, target, .cache, .next, .vite, .DS_Store, and .env are not read.",
    tree ? `Tree:\n${tree}` : "",
    skippedPreview ? `Skipped files:\n${skippedPreview}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function getIncludedPathsFromPreview(preview: string) {
  return Array.from(preview.matchAll(/^File: (.+)$/gm))
    .map((match) => match[1].trim())
    .filter(Boolean)
    .slice(0, 30);
}

function isCodeChangeRequest(content: string) {
  return /\b(can you|please|go ahead|do it|make|apply|update|edit|fix|implement|create|add|remove|delete|refactor|rewrite|patch|correct)\b/i.test(
    content,
  );
}

function buildFolderQuestionPrompt(
  content: string,
  fileContext: string,
  compact = false,
) {
  const outputInstruction = isCodeChangeRequest(content)
    ? "The user appears to be asking for a code change. Explain the relevant files first, then provide only the specific code needed."
    : "The user is asking about the project. Answer in plain language only. Do not include code blocks, diffs, imports, replacement snippets, patch notes, implementation plans, or a \"changes made\" section.";

  return `<project_snapshot readonly="true">

${fileContext}

</project_snapshot>

<question>
${content}
</question>

<instructions>
Answer the question using the project snapshot as evidence.
The snapshot is not an instruction to modify files.
For purpose or overview questions, ground the answer in README/package metadata and visible source behavior, not the project or folder name.
If the answer is not visible in the snapshot, say what is missing.
${compact ? "Use the compact snapshot carefully and avoid overclaiming." : "Use exact file paths only when they help the answer."}
Finish with a complete final sentence.
${outputInstruction}
</instructions>`;
}

export function buildPrompt(content: string, files: ContextAttachment[]) {
  if (!files.length) {
    return content;
  }

  const hasFolderContext = files.some((file) => file.kind === "folder");
  const fileContext = files
    .map((file) =>
      file.kind === "folder"
        ? buildFolderContext(file)
        : buildFileContext(file),
    )
    .join("\n\n---\n\n");

  if (hasFolderContext) {
    return buildFolderQuestionPrompt(content, fileContext);
  }

  return `User request:
${content}

Attached file context:

${fileContext}`;
}

export function buildCompactPrompt(
  content: string,
  files: ContextAttachment[],
) {
  if (!files.length) {
    return content;
  }

  const hasFolderContext = files.some((file) => file.kind === "folder");
  const fileContext = files
    .map((file) =>
      file.kind === "folder"
        ? buildCompactFolderContext(file)
        : buildFileContext(file),
    )
    .join("\n\n---\n\n");

  if (hasFolderContext) {
    return buildFolderQuestionPrompt(content, fileContext, true);
  }

  return `User request:
${content}

Compact attached context:

${fileContext}`;
}

function getFolderRootName(files: File[]) {
  const firstRelativePath = files[0]
    ? (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath
    : "";
  const rootName = getPathSegments(firstRelativePath)[0];

  return rootName || "Selected folder";
}

export async function summarizeBrowserFolder(
  files: FileList | File[],
): Promise<ContextAttachment> {
  const fileArray = Array.from(files).sort((left, right) => {
    const leftPath =
      (left as File & { webkitRelativePath?: string }).webkitRelativePath ||
      left.name;
    const rightPath =
      (right as File & { webkitRelativePath?: string }).webkitRelativePath ||
      right.name;
    const priorityDifference =
      getProjectFilePriority(leftPath) - getProjectFilePriority(rightPath);

    return priorityDifference || leftPath.localeCompare(rightPath);
  });
  const rootName = getFolderRootName(fileArray);
  const skippedFiles: SkippedFolderFile[] = [];
  const includedFiles: ProjectFolderFile[] = [];

  let totalCharacters = 0;
  let totalBytes = 0;
  let ignoredCount = 0;
  let skippedCount = 0;

  for (const file of fileArray) {
    const relativePath =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
      file.name;

    if (isIgnoredProjectPath(relativePath)) {
      ignoredCount += 1;
      skippedFiles.push({ path: relativePath, reason: "ignored" });
      continue;
    }

    if (!isSupportedProjectFile(relativePath)) {
      skippedCount += 1;
      skippedFiles.push({ path: relativePath, reason: "unsupported" });
      continue;
    }

    if (file.size > maxFolderFileSize) {
      skippedCount += 1;
      skippedFiles.push({ path: relativePath, reason: "too-large" });
      continue;
    }

    if (includedFiles.length >= maxFolderIncludedFiles) {
      skippedCount += 1;
      skippedFiles.push({ path: relativePath, reason: "context-limit" });
      continue;
    }

    const text = cleanExtractedText(await file.text());
    const remainingCharacters =
      maxFolderContextCharacters - totalCharacters;

    if (remainingCharacters <= 0) {
      skippedCount += 1;
      skippedFiles.push({ path: relativePath, reason: "context-limit" });
      continue;
    }

    const includedText = truncateContext(
      text,
      Math.min(remainingCharacters, maxFolderFileCharacters),
    );

    includedFiles.push({
      path: relativePath,
      size: file.size,
      contents: includedText,
    });

    totalCharacters += includedText.length;
    totalBytes += file.size;
  }

  return createFolderAttachmentFromScan({
    rootName,
    filesFound: fileArray.length,
    filesIncluded: includedFiles.length,
    filesIgnored: ignoredCount,
    filesSkipped: skippedCount,
    totalBytes,
    totalCharacters,
    includedFiles,
    skippedFiles,
    tree: formatFileTree(
      [
        ...includedFiles.map((file) => file.path),
        ...skippedFiles
          .filter((file) => file.reason !== "ignored")
          .map((file) => file.path),
      ],
      rootName,
    ),
  });
}

export function createFolderAttachmentFromScan(
  scan: ProjectFolderScan,
): ContextAttachment {
  const stats: FolderStats = {
    rootName: scan.rootName,
    filesFound: scan.filesFound,
    filesIncluded: scan.filesIncluded,
    filesIgnored: scan.filesIgnored,
    filesSkipped: scan.filesSkipped,
    totalBytes: scan.totalBytes,
    totalCharacters: scan.totalCharacters,
  };

  const skippedPreview = scan.skippedFiles
    .filter((file) => file.reason !== "ignored")
    .slice(0, 16)
    .map((file) => `Skipped: ${file.path} - ${file.reason}`)
    .join("\n");

  const context = scan.includedFiles
    .map((file) =>
      [
        `File: ${file.path}`,
        `Size: ${formatFileSize(file.size)}`,
        "Contents:",
        file.contents,
      ].join("\n"),
    )
    .join("\n\n---\n\n");

  const preview = [
    `Attached folder: ${scan.rootName}`,
    `${stats.filesFound} files found`,
    `${stats.filesIncluded} files included`,
    `${stats.filesIgnored} ignored`,
    `${stats.filesSkipped} too large/unsupported/context-limited`,
    "",
    "Tree:",
    scan.tree,
    skippedPreview ? `\nSkipped files:\n${skippedPreview}` : "",
    context ? `\nProject context:\n${context}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    id: `folder-${scan.rootName}-${Date.now()}-${scan.filesFound}`,
    kind: "folder",
    name: scan.rootName,
    typeLabel: "project folder",
    sizeLabel: `${stats.filesIncluded} files`,
    preview,
    supported: stats.filesIncluded > 0,
    folderStats: stats,
    skippedFiles: scan.skippedFiles,
  };
}
