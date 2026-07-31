import type { DragEvent } from "react";
import { formatFileSize } from "../services/contextBuilder";
import type { AttachedFile } from "./types";

function isSupportedTextFile(file: File) {
  const lowerName = file.name.toLowerCase();

  return (
    file.type === "text/plain" ||
    file.type === "text/markdown" ||
    file.type === "text/rtf" ||
    file.type === "application/rtf" ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".rtf") ||
    lowerName.endsWith(".docx")
  );
}

function getFileTypeLabel(file: File) {
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith(".docx")) return "Word document";
  if (lowerName.endsWith(".rtf")) return "rich text";
  if (lowerName.endsWith(".md")) return "text/markdown";
  return file.type || "file";
}

function cleanExtractedText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function inflateZipEntry(data: Uint8Array, compressionMethod: number) {
  if (compressionMethod === 0) return data;

  if (compressionMethod !== 8) {
    throw new Error("Unsupported DOCX compression method.");
  }

  const stream = new Blob([data]).stream().pipeThrough(
    new DecompressionStream("deflate-raw"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipTextEntry(
  file: File,
  entryName: string,
): Promise<string | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  let endOfCentralDirectory = -1;

  for (let index = bytes.length - 22; index >= 0; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      endOfCentralDirectory = index;
      break;
    }
  }

  if (endOfCentralDirectory === -1) {
    throw new Error("Could not read DOCX zip directory.");
  }

  const entryCount = view.getUint16(endOfCentralDirectory + 10, true);
  let centralDirectoryOffset = view.getUint32(
    endOfCentralDirectory + 16,
    true,
  );
  const decoder = new TextDecoder();

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (view.getUint32(centralDirectoryOffset, true) !== 0x02014b50) {
      throw new Error("Invalid DOCX zip directory.");
    }

    const compressionMethod = view.getUint16(
      centralDirectoryOffset + 10,
      true,
    );
    const compressedSize = view.getUint32(
      centralDirectoryOffset + 20,
      true,
    );
    const fileNameLength = view.getUint16(
      centralDirectoryOffset + 28,
      true,
    );
    const extraLength = view.getUint16(centralDirectoryOffset + 30, true);
    const commentLength = view.getUint16(
      centralDirectoryOffset + 32,
      true,
    );
    const localHeaderOffset = view.getUint32(
      centralDirectoryOffset + 42,
      true,
    );
    const fileNameStart = centralDirectoryOffset + 46;
    const fileName = decoder.decode(
      bytes.slice(fileNameStart, fileNameStart + fileNameLength),
    );

    if (fileName === entryName) {
      if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
        throw new Error("Invalid DOCX file entry.");
      }

      const localFileNameLength = view.getUint16(
        localHeaderOffset + 26,
        true,
      );
      const localExtraLength = view.getUint16(
        localHeaderOffset + 28,
        true,
      );
      const dataStart =
        localHeaderOffset + 30 + localFileNameLength + localExtraLength;
      const compressedData = bytes.slice(
        dataStart,
        dataStart + compressedSize,
      );
      const inflated = await inflateZipEntry(
        compressedData,
        compressionMethod,
      );
      return decoder.decode(inflated);
    }

    centralDirectoryOffset +=
      46 + fileNameLength + extraLength + commentLength;
  }

  return null;
}

function extractTextFromWordXml(xmlText: string) {
  const xml = new DOMParser().parseFromString(xmlText, "application/xml");
  const paragraphs = Array.from(xml.getElementsByTagNameNS("*", "p"));

  if (!paragraphs.length) {
    return cleanExtractedText(xml.documentElement.textContent ?? "");
  }

  function collectText(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const element = node as Element;
    if (element.localName === "t") return element.textContent ?? "";
    if (element.localName === "tab") return "\t";
    if (element.localName === "br" || element.localName === "cr") return "\n";
    return Array.from(element.childNodes).map(collectText).join("");
  }

  return cleanExtractedText(paragraphs.map(collectText).join("\n"));
}

async function extractDocxText(file: File) {
  const documentXml = await readZipTextEntry(file, "word/document.xml");
  if (!documentXml) throw new Error("DOCX document text was not found.");
  return extractTextFromWordXml(documentXml);
}

function extractRtfText(rtf: string) {
  const ignoredDestinations = new Set([
    "colortbl",
    "fonttbl",
    "generator",
    "info",
    "pict",
    "stylesheet",
  ]);
  const stack: boolean[] = [];
  let output = "";
  let index = 0;
  let ignored = false;

  while (index < rtf.length) {
    const character = rtf[index];

    if (character === "{") {
      stack.push(ignored);
      index += 1;
      if (rtf[index] === "\\" && rtf[index + 1] === "*") {
        ignored = true;
        index += 2;
      }
      continue;
    }

    if (character === "}") {
      ignored = stack.pop() ?? false;
      index += 1;
      continue;
    }

    if (character !== "\\") {
      if (!ignored) output += character;
      index += 1;
      continue;
    }

    const escaped = rtf[index + 1];
    if (escaped === "\\" || escaped === "{" || escaped === "}") {
      if (!ignored) output += escaped;
      index += 2;
      continue;
    }

    if (escaped === "'") {
      const hex = rtf.slice(index + 2, index + 4);
      if (!ignored && /^[0-9a-f]{2}$/i.test(hex)) {
        output += String.fromCharCode(Number.parseInt(hex, 16));
      }
      index += 4;
      continue;
    }

    const match = rtf.slice(index + 1).match(/^([a-z]+)(-?\d+)? ?/i);
    if (!match) {
      index += 2;
      continue;
    }

    const controlWord = match[1].toLowerCase();
    if (ignoredDestinations.has(controlWord)) ignored = true;

    if (!ignored) {
      if (controlWord === "par" || controlWord === "line") output += "\n";
      else if (controlWord === "tab") output += "\t";
    }
    index += 1 + match[0].length;
  }

  return cleanExtractedText(output);
}

async function extractFileText(file: File) {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".docx")) return extractDocxText(file);

  const text = await file.text();
  if (lowerName.endsWith(".rtf") || file.type === "text/rtf") {
    return extractRtfText(text);
  }
  return cleanExtractedText(text);
}

export async function summarizeFile(
  file: File,
  previewCharacterLimit: number,
): Promise<AttachedFile> {
  const supported = isSupportedTextFile(file);
  const typeLabel = getFileTypeLabel(file);
  let preview = "Preview unavailable for this file type.";

  if (supported) {
    try {
      const text = await extractFileText(file);
      preview = text
        ? text.length > previewCharacterLimit
          ? `${text.slice(0, previewCharacterLimit)}\n\n[Only the first ${previewCharacterLimit.toLocaleString()} of ${text.length.toLocaleString()} characters were included.]`
          : text
        : "No readable text found in this file.";
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not read file.";
      preview = `Could not extract text: ${message}`;
    }
  }

  return {
    id: `${file.name}-${file.lastModified}-${file.size}`,
    kind: "file",
    name: file.name,
    typeLabel,
    sizeLabel: formatFileSize(file.size),
    preview,
    supported,
  };
}

export function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

export function hasDraggedFiles(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes("Files");
}
