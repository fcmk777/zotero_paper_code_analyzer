import {
  DEFAULT_CODE_CONTEXT_POLICY,
  type CodeContextPolicy,
} from "./code-policy";

export interface RepoTreeFile {
  path: string;
  type: "blob";
  size?: number;
}

export interface ScoredRepoFile extends RepoTreeFile {
  score: number;
  reason: string;
}

export interface SourceFileInput {
  path: string;
  content: string;
}

export interface NumberedSourceFile {
  path: string;
  language: string;
  chars: number;
  truncated: boolean;
  startLine?: number;
  endLine?: number;
  totalLines?: number;
  contentMarkdown: string;
}

export interface SourceSearchMatch {
  path: string;
  query: string;
  lineNumber: number;
  snippet: string;
}

const EXT_LANGUAGE: Record<string, string> = {
  ".py": "python",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".c": "c",
  ".h": "cpp",
  ".hpp": "cpp",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".json": "json",
  ".toml": "toml",
  ".md": "markdown",
};

export function scoreRepoFile(
  file: RepoTreeFile,
  policy: CodeContextPolicy = DEFAULT_CODE_CONTEXT_POLICY,
): ScoredRepoFile | null {
  const path = normalizeRepoPath(file.path);
  if (!path || file.type !== "blob") return null;
  if (hasSkippedDir(path, policy)) return null;
  const extension = extensionOf(path);
  if (!policy.codeAllowedExtensions.includes(extension)) return null;

  const filename = basename(path).toLowerCase();
  const parts = path.split("/");
  const dirs = parts.slice(0, -1).map((part) => part.toLowerCase());
  const lowerPath = path.toLowerCase();
  const reasons: string[] = [];
  let score = 10;

  const filenameIndex = policy.codePriorityFilenames.indexOf(filename);
  if (filenameIndex >= 0) {
    score += 80 - Math.min(filenameIndex, 30);
    reasons.push(`priority filename: ${filename}`);
  }

  for (const dir of dirs) {
    const dirIndex = policy.codePriorityDirs.indexOf(dir);
    if (dirIndex >= 0) {
      score += 28 - Math.min(dirIndex, 18);
      reasons.push(`priority dir: ${dir}`);
    }
  }

  const keywordMatches = policy.codePathKeywords.filter((keyword) =>
    lowerPath.includes(keyword),
  );
  if (keywordMatches.length) {
    score += Math.min(keywordMatches.length, 4) * 8;
    reasons.push(`path keywords: ${keywordMatches.slice(0, 4).join(", ")}`);
  }

  if (extension === ".md") {
    score += filename.startsWith("readme") ? 10 : -18;
    reasons.push(
      filename.startsWith("readme")
        ? "readme context"
        : "markdown lower priority",
    );
  }
  if (
    extension === ".json" ||
    extension === ".yaml" ||
    extension === ".yml" ||
    extension === ".toml"
  ) {
    score -=
      filename.includes("config") || lowerPath.includes("config") ? 0 : 8;
    reasons.push("configuration-like file");
  }

  const depth = parts.length - 1;
  if (depth > 4) score -= (depth - 4) * 4;

  if (typeof file.size === "number") {
    if (file.size > 1_000_000) score -= 35;
    else if (file.size > 250_000) score -= 18;
    else if (file.size > 100_000) score -= 8;
  }

  return {
    path,
    type: "blob",
    ...(typeof file.size === "number" ? { size: file.size } : {}),
    score,
    reason: reasons.length
      ? dedupe(reasons).join(" + ")
      : `allowed extension: ${extension}`,
  };
}

export function selectRelevantFiles(
  files: RepoTreeFile[],
  policy: CodeContextPolicy = DEFAULT_CODE_CONTEXT_POLICY,
): ScoredRepoFile[] {
  return files
    .map((file) => scoreRepoFile(file, policy))
    .filter((file): file is ScoredRepoFile => !!file)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, policy.codeMaxSelectedFiles);
}

export function filterRepoTreeFiles(
  files: RepoTreeFile[],
  policy: CodeContextPolicy = DEFAULT_CODE_CONTEXT_POLICY,
): ScoredRepoFile[] {
  return files
    .map((file) => scoreRepoFile(file, policy))
    .filter((file): file is ScoredRepoFile => !!file)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, policy.codeRepoTreeMaxEntries);
}

export function addLineNumbers(content: string): string {
  const lines = content.split(/\r?\n/);
  return lines
    .map((line, index) => `${String(index + 1).padStart(4, " ")} | ${line}`)
    .join("\n");
}

export function formatFilesWithLineNumbers(
  files: SourceFileInput[],
  policy: CodeContextPolicy = DEFAULT_CODE_CONTEXT_POLICY,
): { files: NumberedSourceFile[]; totalChars: number } {
  const out: NumberedSourceFile[] = [];
  let remaining = policy.codeTotalCharBudget;
  let totalChars = 0;

  for (const file of files) {
    if (remaining <= 0) break;
    const numbered = addLineNumbers(file.content);
    const cap = Math.min(policy.codeMaxFileChars, remaining);
    const truncated = numbered.length > cap;
    const body = truncated ? numbered.slice(0, cap) : numbered;
    const chars = body.length;
    const language = languageForPath(file.path);
    out.push({
      path: normalizeRepoPath(file.path),
      language,
      chars,
      truncated,
      contentMarkdown: [
        `### ${normalizeRepoPath(file.path)}`,
        "",
        `\`\`\`${language}`,
        body,
        "```",
      ].join("\n"),
    });
    totalChars += chars;
    remaining -= chars;
  }

  return { files: out, totalChars };
}

export function formatFileRangeWithLineNumbers(
  path: string,
  content: string,
  startLine: number,
  endLine: number,
  policy: CodeContextPolicy = DEFAULT_CODE_CONTEXT_POLICY,
): NumberedSourceFile {
  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;
  const safeStart = Math.max(1, Math.floor(startLine));
  const maxEnd = Math.min(totalLines, safeStart + policy.codeRangeMaxLines - 1);
  const safeEnd = Math.min(Math.max(safeStart, Math.floor(endLine)), maxEnd);
  const selected = lines.slice(safeStart - 1, safeEnd);
  const numbered = selected
    .map(
      (line, index) =>
        `${String(safeStart + index).padStart(4, " ")} | ${line}`,
    )
    .join("\n");
  const cap = Math.min(policy.codeMaxFileChars, policy.codeTotalCharBudget);
  const truncated = numbered.length > cap || safeEnd < Math.floor(endLine);
  const body = numbered.length > cap ? numbered.slice(0, cap) : numbered;
  const language = languageForPath(path);
  return {
    path: normalizeRepoPath(path),
    language,
    chars: body.length,
    truncated,
    startLine: safeStart,
    endLine: safeEnd,
    totalLines,
    contentMarkdown: [
      `### ${normalizeRepoPath(path)} lines ${safeStart}-${safeEnd}`,
      "",
      `\`\`\`${language}`,
      body,
      "```",
    ].join("\n"),
  };
}

export function searchSourceContent(
  path: string,
  content: string,
  queries: string[],
  maxMatches: number,
  contextLines = 2,
): SourceSearchMatch[] {
  const normalizedQueries = queries
    .map((query) => query.trim())
    .filter(Boolean);
  if (!normalizedQueries.length || maxMatches <= 0) return [];
  const lines = content.split(/\r?\n/);
  const matches: SourceSearchMatch[] = [];
  for (let index = 0; index < lines.length; index++) {
    const lower = lines[index].toLowerCase();
    const query = normalizedQueries.find((candidate) =>
      lower.includes(candidate.toLowerCase()),
    );
    if (!query) continue;
    const from = Math.max(0, index - contextLines);
    const to = Math.min(lines.length, index + contextLines + 1);
    const snippet = lines
      .slice(from, to)
      .map(
        (line, offset) =>
          `${String(from + offset + 1).padStart(4, " ")} | ${line}`,
      )
      .join("\n");
    matches.push({
      path: normalizeRepoPath(path),
      query,
      lineNumber: index + 1,
      snippet,
    });
    if (matches.length >= maxMatches) break;
  }
  return matches;
}

export function languageForPath(path: string): string {
  return EXT_LANGUAGE[extensionOf(path)] ?? "";
}

export function isAllowedSourcePath(
  path: string,
  policy: CodeContextPolicy = DEFAULT_CODE_CONTEXT_POLICY,
): boolean {
  return (
    !hasSkippedDir(path, policy) &&
    policy.codeAllowedExtensions.includes(extensionOf(path))
  );
}

export function isLikelyBinaryContent(text: string): boolean {
  if (!text) return false;
  if (text.includes("\u0000")) return true;
  const sample = text.slice(0, 4000);
  let control = 0;
  for (const char of sample) {
    const code = char.charCodeAt(0);
    if (code < 9 || (code > 13 && code < 32)) control += 1;
  }
  return control / sample.length > 0.05;
}

export function normalizeRepoPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}

function hasSkippedDir(path: string, policy: CodeContextPolicy): boolean {
  const skip = new Set(policy.codeSkipDirs.map((dir) => dir.toLowerCase()));
  const parts = normalizeRepoPath(path).split("/");
  return parts.slice(0, -1).some((part) => skip.has(part.toLowerCase()));
}

function extensionOf(path: string): string {
  const name = basename(path).toLowerCase();
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index) : "";
}

function basename(path: string): string {
  const normalized = normalizeRepoPath(path);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}
