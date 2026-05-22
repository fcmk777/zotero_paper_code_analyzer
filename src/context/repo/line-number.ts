import type { RepoContextPolicy } from "./repo-policy";
import { languageForPath } from "./file-classifier";

export interface NumberedFileSlice {
  path: string;
  language: string;
  totalLines: number;
  startLine: number;
  endLine: number;
  returnedLines: string;
  contentMarkdown: string;
  chars: number;
  truncated: boolean;
}

export function withLineNumbers(content: string, startLine = 1): string {
  const lines = normalizeNewlines(content).split("\n");
  return lines
    .map(
      (line, index) =>
        `${String(startLine + index).padStart(4, " ")} | ${line}`,
    )
    .join("\n");
}

export function readFileSliceWithLineNumbers(
  path: string,
  content: string,
  policy: RepoContextPolicy,
  startLine = 1,
  endLine?: number,
): NumberedFileSlice {
  const normalized = normalizeNewlines(content);
  const lines = normalized.split("\n");
  const totalLines = normalized.length ? lines.length : 0;
  const safeStart = Math.max(1, Math.floor(startLine || 1));
  const requestedEnd =
    endLine == null
      ? totalLines || 1
      : Math.max(safeStart, Math.floor(endLine || safeStart));
  let slice = lines.slice(safeStart - 1, requestedEnd);
  let truncated = requestedEnd < totalLines;
  let numbered = withLineNumbers(slice.join("\n"), safeStart);
  if (numbered.length > policy.maxReadFileChars) {
    const allowed: string[] = [];
    let chars = 0;
    for (const line of slice) {
      const rendered = `${String(safeStart + allowed.length).padStart(4, " ")} | ${line}`;
      if (chars + rendered.length + 1 > policy.maxReadFileChars) break;
      allowed.push(line);
      chars += rendered.length + 1;
    }
    slice = allowed;
    numbered = withLineNumbers(slice.join("\n"), safeStart);
    truncated = true;
  }
  const returnedEnd = slice.length
    ? safeStart + slice.length - 1
    : safeStart - 1;
  const language = languageForPath(path);
  const contentMarkdown = [
    `### ${path}`,
    "",
    `\`\`\`${language}`,
    numbered,
    "```",
    "",
    "metadata:",
    `- truncated: ${truncated ? "true" : "false"}`,
    `- totalLines: ${totalLines}`,
    `- returnedLines: ${safeStart}-${returnedEnd}`,
  ].join("\n");
  return {
    path,
    language,
    totalLines,
    startLine: safeStart,
    endLine: returnedEnd,
    returnedLines: `${safeStart}-${returnedEnd}`,
    contentMarkdown,
    chars: contentMarkdown.length,
    truncated,
  };
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}
