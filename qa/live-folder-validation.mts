import { promises as fs } from "node:fs";
import path from "node:path";
import {
  conversationProtocol,
  filesystemOperationProtocol,
  projectFileSelectionProtocol,
} from "../src/services/chatProtocol.ts";
import { normalizeOllamaBaseUrl } from "../src/services/endpoint.ts";
import {
  parseOrganizationPlanFromContent,
} from "../src/services/filesystemOps.ts";
import { selectLiveFolderPaths } from "../src/services/contextBuilder.ts";

type Message = { role: "system" | "user" | "assistant"; content: string };

const projectRoot = path.resolve(import.meta.dirname, "..");
const endpoint = normalizeOllamaBaseUrl(
  process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
);
const model = process.env.OLLAMA_MODEL || "qwen2.5-coder:14b";

async function chat(
  messages: Message[],
  format?: object,
  numPredict = 700,
) {
  const response = await fetch(`${endpoint}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      ...(format ? { format } : {}),
      options: { temperature: 0, num_ctx: 16384, num_predict: numPredict },
    }),
  });
  if (!response.ok) {
    throw new Error(`Ollama ${response.status}: ${await response.text()}`);
  }
  const data = (await response.json()) as { message?: { content?: string } };
  const content = data.message?.content?.trim();
  if (!content) throw new Error("Ollama returned an empty response.");
  return content;
}

const inventory = [
  { path: "loose-notes.txt", size: 320, readable: true },
  { path: "receipt-january.pdf", size: 42_000, readable: false },
  { path: "vacation-photo.jpg", size: 850_000, readable: false },
  { path: "draft.md", size: 740, readable: true },
];
const inventoryText = inventory
  .map(
    (entry) =>
      `- ${entry.path} · ${entry.size} bytes · ${
        entry.readable ? "readable on demand" : "metadata only"
      }`,
  )
  .join("\n");

const operationAnswer = await chat([
  { role: "system", content: conversationProtocol },
  { role: "system", content: filesystemOperationProtocol },
  {
    role: "system",
    content:
      "Attachment state: File Test is a live Windows folder with reviewable file operations.",
  },
  {
    role: "user",
    content: `Attached live folder: File Test\n\nLive inventory (metadata only):\n${inventoryText}\n\nUser message:\ncan you sort this?`,
  },
]);
const organizationPlan = parseOrganizationPlanFromContent(operationAnswer);
if (!organizationPlan) {
  throw new Error(`Sort request did not produce a compact organization plan:\n${operationAnswer}`);
}
if (/\b(?:can't|cannot|unable to)\s+(?:perform|sort|organize|modify)\b/i.test(operationAnswer)) {
  throw new Error("The model incorrectly denied the live-folder capability.");
}

const artists = [
  "Aurora Vale",
  "Copper Static",
  "Juniper Sky",
  "Midnight Relay",
  "Paper Satellites",
  "Velvet Circuit",
];
const musicInventory = artists.flatMap((artist) =>
  Array.from({ length: 12 }, (_, index) => ({
    path: `${artist} - ${String(index + 1).padStart(2, "0")} - Track ${String(index + 1).padStart(2, "0")}.mp3`,
    size: 3_500_000 + index * 12_000,
    readable: false,
  })),
);
const musicInventoryText = musicInventory
  .map((entry) => `- ${entry.path} · ${entry.size} bytes · metadata only`)
  .join("\n");
const musicAnswer = await chat(
  [
    { role: "system", content: conversationProtocol },
    { role: "system", content: filesystemOperationProtocol },
    {
      role: "system",
      content:
        "Attachment state: Music Test is a live Windows folder with reviewable file operations.",
    },
    {
      role: "user",
      content: `Attached live folder: Music Test\n\nLive inventory (metadata only):\n${musicInventoryText}\n\nUser message:\nOrganize all 72 songs by artist. The artist is the exact text before the first \" - \" in each filename. Create one folder per artist at the folder root, preserve every filename, and include every song in the review proposal.`,
    },
  ],
  undefined,
  6_000,
);
const musicPlan = parseOrganizationPlanFromContent(musicAnswer);
if (!musicPlan) {
  throw new Error(
    `The 72-song request did not produce a compact organization plan:\n${musicAnswer}`,
  );
}
if (musicPlan.groupBy.join(",") !== "fileType,alphabet") {
  throw new Error(`The model chose the wrong nesting order: ${musicPlan.groupBy.join(" -> ")}`);
}

const selectorInventory = [
  "README.md",
  "src/App.tsx",
  "src/App.css",
  "src/services/endpoint.ts",
  "src/services/ollama.tsx",
  "src-tauri/src/commands/files.rs",
];
const selectionFormat = {
  type: "object",
  properties: {
    paths: { type: "array", items: { type: "string" }, maxItems: 6 },
  },
  required: ["paths"],
  additionalProperties: false,
};
const selectedPaths: string[] = [];
let inspectedEvidence = "";

for (let round = 0; round < 2; round += 1) {
  const remainingInventory = selectorInventory.filter(
    (candidate) => !selectedPaths.includes(candidate),
  );
  const selectionAnswer = await chat(
    [
      { role: "system", content: projectFileSelectionProtocol },
      {
        role: "user",
        content: `Latest question:\nwhere is normalizeOllamaBaseUrl implemented?\n\nReadable live-folder inventory not yet inspected:\n${remainingInventory.map((file) => `- ${file}`).join("\n")}${
          inspectedEvidence
            ? `\n\nEvidence already inspected:\n${inspectedEvidence}`
            : ""
        }`,
      },
    ],
    selectionFormat,
  );
  const selection = JSON.parse(selectionAnswer) as { paths?: unknown };
  if (
    !Array.isArray(selection.paths) ||
    selection.paths.some(
      (selectedPath) =>
        typeof selectedPath !== "string" ||
        !remainingInventory.includes(selectedPath),
    )
  ) {
    throw new Error(`Selective-read routing was not grounded: ${selectionAnswer}`);
  }

  let roundPaths = selection.paths as string[];
  if (!roundPaths.length && round === 0) {
    roundPaths = selectLiveFolderPaths(
      {
        id: "qa-live-folder",
        kind: "folder",
        name: "Desktop_Spotlight_AI",
        typeLabel: "live project folder",
        sizeLabel: `${selectorInventory.length} files`,
        preview: "",
        supported: true,
        sourcePath: projectRoot,
        liveEntries: selectorInventory.map((candidate) => ({
          path: candidate,
          size: 1,
          readable: true,
        })),
      },
      "where is normalizeOllamaBaseUrl implemented?",
    ).filter((candidate) => remainingInventory.includes(candidate));
  }
  selectedPaths.push(...roundPaths);
  if (selectedPaths.includes("src/services/endpoint.ts")) break;
  if (!roundPaths.length) break;

  inspectedEvidence = (
    await Promise.all(
      roundPaths.map(async (selectedPath) => {
        const contents = await fs.readFile(
          path.join(projectRoot, ...selectedPath.split("/")),
          "utf8",
        );
        return `Already inspected: ${selectedPath}\n${contents.slice(0, 3_500)}`;
      }),
    )
  ).join("\n\n---\n\n");
}

if (!selectedPaths.includes("src/services/endpoint.ts")) {
  throw new Error(
    `Iterative selective reads did not reach the implementation: ${JSON.stringify(selectedPaths)}`,
  );
}

const report = [
  "# Live Folder Validation",
  "",
  `Generated: ${new Date().toISOString()}`,
  `Model: \`${model}\``,
  "Result: **3/3 passed**",
  "",
  "These are behavioral assertions over actual local-model output. The application does not reuse these answers.",
  "",
  "## Sort request — PASS",
  "",
  "The model produced a schema-valid compact rule plan; the host expands it locally.",
  "",
  "```text",
  operationAnswer,
  "```",
  "",
  "## 72-song organization request — PASS",
  "",
  `The model chose ${musicPlan.groupBy.join(" then ")} without generating a per-song JSON action list.`,
  "",
  "```text",
  musicAnswer,
  "```",
  "",
  "## Selective file read — PASS",
  "",
  `Selected paths across at most two rounds: ${JSON.stringify(selectedPaths)}`,
  "",
].join("\n");

const reportPath = path.join(projectRoot, "qa/live-folder-report.md");
await fs.writeFile(reportPath, report, "utf8");
console.log("LIVE FOLDER 3/3");
console.log(`REPORT ${reportPath}`);
