import { memo, type ReactNode } from "react";

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;
  const inlinePattern =
    /(`([^`]+)`)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(\*\*\*([^*]+)\*\*\*)|(\*\*([^*]+)\*\*)|(\*([^*\s](?:[^*]*?[^*\s])?)\*)/g;

  for (const match of text.matchAll(inlinePattern)) {
    const matchIndex = match.index ?? 0;
    const raw = match[0];

    if (matchIndex > cursor) parts.push(text.slice(cursor, matchIndex));
    const key = `${keyPrefix}-${matchIndex}`;

    if (match[2]) {
      parts.push(<code key={key}>{match[2]}</code>);
    } else if (match[4] && match[5]) {
      parts.push(
        <a key={key} href={match[5]} target="_blank" rel="noreferrer">
          {match[4]}
        </a>,
      );
    } else if (match[7]) {
      parts.push(
        <strong key={key}>
          <em>{match[7]}</em>
        </strong>,
      );
    } else if (match[9]) {
      parts.push(<strong key={key}>{match[9]}</strong>);
    } else if (match[11]) {
      parts.push(<em key={key}>{match[11]}</em>);
    }

    cursor = matchIndex + raw.length;
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function isTableDivider(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(
    line,
  );
}

function splitTableCells(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isMarkdownTable(lines: string[], index: number) {
  return (
    lines[index]?.includes("|") &&
    lines[index + 1]?.includes("|") &&
    isTableDivider(lines[index + 1])
  );
}

function renderMarkdown(text: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let index = 0;

  function pushParagraph(startIndex: number) {
    const paragraphLines: string[] = [];

    while (index < lines.length) {
      const line = lines[index];
      if (
        !line.trim() ||
        /^#{1,6}\s+/.test(line) ||
        /^```/.test(line.trim()) ||
        /^>\s?/.test(line) ||
        /^[-*]\s+/.test(line) ||
        /^\d+\.\s+/.test(line) ||
        isMarkdownTable(lines, index)
      ) {
        break;
      }

      paragraphLines.push(line.trim());
      index += 1;
    }

    const paragraph = paragraphLines.join(" ").trim();
    if (paragraph) {
      blocks.push(
        <p key={`p-${startIndex}`}>
          {renderInlineMarkdown(paragraph, `p-${startIndex}`)}
        </p>,
      );
    }
  }

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    const blockKey = `${index}-${blocks.length}`;

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${blockKey}`} />);
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;

      blocks.push(
        <pre key={`code-${blockKey}`}>
          <code data-language={language || undefined}>
            {codeLines.join("\n")}
          </code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      const HeadingTag = `h${Math.min(heading[1].length + 2, 5)}` as
        | "h3"
        | "h4"
        | "h5";
      blocks.push(
        <HeadingTag key={`h-${blockKey}`}>
          {renderInlineMarkdown(heading[2].trim(), `h-${blockKey}`)}
        </HeadingTag>,
      );
      index += 1;
      continue;
    }

    if (isMarkdownTable(lines, index)) {
      const headers = splitTableCells(lines[index]);
      const rows: string[][] = [];
      index += 2;

      while (index < lines.length && lines[index].includes("|")) {
        if (!isTableDivider(lines[index])) rows.push(splitTableCells(lines[index]));
        index += 1;
      }

      blocks.push(
        <div className="markdown-table-wrap" key={`table-${blockKey}`}>
          <table>
            <thead>
              <tr>
                {headers.map((header, cellIndex) => (
                  <th key={`h-${cellIndex}`}>
                    {renderInlineMarkdown(
                      header,
                      `table-${blockKey}-h-${cellIndex}`,
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`r-${rowIndex}`}>
                  {headers.map((_, cellIndex) => (
                    <td key={`c-${cellIndex}`}>
                      {renderInlineMarkdown(
                        row[cellIndex] ?? "",
                        `table-${blockKey}-${rowIndex}-${cellIndex}`,
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const unorderedList = /^[-*]\s+/.test(line);
    const orderedList = /^\d+\.\s+/.test(line);
    if (unorderedList || orderedList) {
      const items: string[] = [];
      const listPattern = unorderedList ? /^[-*]\s+/ : /^\d+\.\s+/;
      const ListTag = unorderedList ? "ul" : "ol";

      while (index < lines.length && listPattern.test(lines[index])) {
        items.push(lines[index].replace(listPattern, "").trim());
        index += 1;
      }

      blocks.push(
        <ListTag key={`list-${blockKey}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>
              {renderInlineMarkdown(item, `list-${blockKey}-${itemIndex}`)}
            </li>
          ))}
        </ListTag>,
      );
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, "").trim());
        index += 1;
      }
      blocks.push(
        <blockquote key={`quote-${blockKey}`}>
          {renderInlineMarkdown(
            quoteLines.join(" "),
            `quote-${blockKey}`,
          )}
        </blockquote>,
      );
      continue;
    }

    pushParagraph(index);
  }

  return blocks;
}

export const MarkdownMessage = memo(function MarkdownMessage({
  content,
}: {
  content: string;
}) {
  return <div className="message-markdown">{renderMarkdown(content)}</div>;
});
