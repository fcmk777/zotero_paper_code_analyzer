import { extensionForPath, languageForPath } from "./file-classifier";
import type { RepoSymbol, RepoSymbolSkeleton } from "./types";

const MAX_SYMBOLS_PER_FILE = 160;

export function extractSymbolSkeleton(
  path: string,
  content: string,
): RepoSymbolSkeleton {
  const language = languageForPath(path);
  const symbols =
    language === "python"
      ? extractPythonSymbols(content)
      : language === "typescript" || language === "javascript"
        ? extractJavaScriptSymbols(content)
        : language === "yaml" || language === "json" || language === "toml"
          ? extractConfigSymbols(path, content)
          : language === "jupyter"
            ? extractNotebookSymbols(content)
            : [];
  const limited = symbols.slice(0, MAX_SYMBOLS_PER_FILE);
  return {
    path,
    language,
    symbols: limited,
    summary: summarizeSymbols(path, limited),
    truncated: limited.length < symbols.length,
  };
}

export function formatSymbolSkeleton(skeleton: RepoSymbolSkeleton): string {
  const lines = [
    `### ${skeleton.path}`,
    `language: ${skeleton.language}`,
    skeleton.summary,
  ];
  for (const symbol of skeleton.symbols) {
    lines.push(
      `- L${symbol.line} ${symbol.kind}: ${symbol.name}${
        symbol.detail ? ` (${symbol.detail})` : ""
      }`,
    );
  }
  if (skeleton.truncated) lines.push("- ... truncated");
  return lines.join("\n");
}

function extractPythonSymbols(content: string): RepoSymbol[] {
  const symbols: RepoSymbol[] = [];
  const lines = normalizeNewlines(content).split("\n");
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const trimmed = line.trim();
    if (/^(import|from)\s+/.test(trimmed)) {
      symbols.push({
        kind: "import",
        name: trimmed.slice(0, 160),
        line: lineNo,
      });
    }
    const cls = line.match(/^class\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?:/);
    if (cls) {
      symbols.push({
        kind: "class",
        name: cls[1],
        line: lineNo,
        ...(cls[2] ? { detail: cls[2].slice(0, 120) } : {}),
      });
    }
    const fn = line.match(/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)/);
    if (fn) {
      symbols.push({
        kind: "function",
        name: fn[1],
        line: lineNo,
        detail: fn[2].slice(0, 120),
      });
    }
    if (/if\s+__name__\s*==\s*["']__main__["']/.test(trimmed)) {
      symbols.push({ kind: "entrypoint", name: "__main__", line: lineNo });
    }
  });
  return symbols;
}

function extractJavaScriptSymbols(content: string): RepoSymbol[] {
  const symbols: RepoSymbol[] = [];
  const lines = normalizeNewlines(content).split("\n");
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const trimmed = line.trim();
    if (/^import\s+/.test(trimmed)) {
      symbols.push({
        kind: "import",
        name: trimmed.slice(0, 160),
        line: lineNo,
      });
    }
    if (/^export\s+/.test(trimmed)) {
      symbols.push({
        kind: "export",
        name: trimmed.slice(0, 160),
        line: lineNo,
      });
    }
    const cls = line.match(/(?:export\s+default\s+|export\s+)?class\s+([A-Za-z_$][\w$]*)/);
    if (cls) symbols.push({ kind: "class", name: cls[1], line: lineNo });
    const fn = line.match(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
    if (fn) symbols.push({ kind: "function", name: fn[1], line: lineNo });
    const arrow = line.match(/(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/);
    if (arrow) symbols.push({ kind: "function", name: arrow[1], line: lineNo });
  });
  return symbols;
}

function extractConfigSymbols(path: string, content: string): RepoSymbol[] {
  const ext = extensionForPath(path);
  if (ext === ".json") {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return Object.keys(parsed)
          .slice(0, MAX_SYMBOLS_PER_FILE)
          .map((key) => ({ kind: "config_key", name: key, line: 1 }));
      }
    } catch {}
  }
  return normalizeNewlines(content)
    .split("\n")
    .flatMap((line, index) => {
      const match = line.match(/^([A-Za-z0-9_.-]+)\s*[:=]/);
      return match
        ? [{ kind: "config_key" as const, name: match[1], line: index + 1 }]
        : [];
    });
}

function extractNotebookSymbols(content: string): RepoSymbol[] {
  try {
    const parsed = JSON.parse(content) as {
      cells?: Array<{ cell_type?: string; source?: string[] | string }>;
    };
    if (!Array.isArray(parsed.cells)) return [];
    const symbols: RepoSymbol[] = [];
    parsed.cells.forEach((cell, index) => {
      const source = Array.isArray(cell.source)
        ? cell.source.join("")
        : cell.source ?? "";
      if (cell.cell_type === "markdown") {
        const heading = source
          .split(/\r?\n/)
          .find((line) => /^#+\s+/.test(line.trim()));
        if (heading) {
          symbols.push({
            kind: "notebook_heading",
            name: heading.replace(/^#+\s+/, "").trim(),
            line: index + 1,
            detail: `cell ${index}`,
          });
        }
      }
      if (cell.cell_type === "code") {
        const py = extractPythonSymbols(source)
          .filter((symbol) => symbol.kind !== "import")
          .slice(0, 8);
        for (const symbol of py) {
          symbols.push({
            ...symbol,
            kind: "notebook_code",
            line: index + 1,
            detail: `cell ${index}: ${symbol.kind} ${symbol.name}`,
          });
        }
      }
    });
    return symbols;
  } catch {
    return [];
  }
}

function summarizeSymbols(path: string, symbols: RepoSymbol[]): string {
  const classes = symbols.filter((symbol) => symbol.kind === "class").length;
  const functions = symbols.filter((symbol) => symbol.kind === "function").length;
  const imports = symbols.filter((symbol) => symbol.kind === "import").length;
  const configKeys = symbols.filter((symbol) => symbol.kind === "config_key").length;
  return `symbols: classes=${classes}, functions=${functions}, imports=${imports}, configKeys=${configKeys}, total=${symbols.length} in ${path}`;
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}
