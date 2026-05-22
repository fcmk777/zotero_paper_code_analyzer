import {
  codeError,
  type CodeResult,
} from "../context/code-github";
import { profileFilePath } from "./profile-path";

export interface CodeRepoBinding {
  itemID: number;
  githubUrl: string;
  owner: string;
  repo: string;
  branch?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CodeAnalysisRecord {
  itemID: number;
  githubUrl: string;
  owner: string;
  repo: string;
  branch?: string;
  sections: string[];
  markdown: string;
  createdAt: number;
  updatedAt: number;
}

export interface SaveCodeRepoBindingInput {
  githubUrl: string;
  owner: string;
  repo: string;
  branch?: string;
}

export interface SaveCodeAnalysisInput extends SaveCodeRepoBindingInput {
  sections: string[];
  markdown: string;
}

interface StoredCodeAnalysis {
  [key: string]: unknown;
}

interface ZoteroFileAPI {
  getContentsAsync(path: string, charset?: string): Promise<string>;
  putContentsAsync(path: string, contents: string): Promise<void>;
}

interface ZoteroProfileAPI {
  dir: string;
}

interface ZoteroGlobal {
  File: ZoteroFileAPI;
  Profile: ZoteroProfileAPI;
}

interface StorageOptions {
  now?: () => number;
}

const CODE_ANALYSIS_FILE = "zotero-ai-sidebar-code-analysis.json";
let writeQueue: Promise<void> = Promise.resolve();

export async function loadCodeRepoBinding(
  itemID: number | null,
): Promise<CodeResult<{ binding: CodeRepoBinding }>> {
  if (itemID == null) {
    return codeError("NO_CURRENT_ITEM", "当前没有选中的 Zotero 条目。");
  }
  const stored = await readStored();
  const binding = normalizeRepoBinding(stored[bindingKey(itemID)]);
  if (!binding) {
    return codeError(
      "NO_BOUND_REPOSITORY",
      "当前 Zotero 条目还没有绑定 GitHub 仓库 URL。",
    );
  }
  return { ok: true, binding };
}

export function saveCodeRepoBinding(
  itemID: number | null,
  input: SaveCodeRepoBindingInput,
  options: StorageOptions = {},
): Promise<CodeResult<{ binding: CodeRepoBinding }>> {
  if (itemID == null) {
    return Promise.resolve(codeError("NO_CURRENT_ITEM", "当前没有选中的 Zotero 条目。"));
  }
  const now = options.now?.() ?? Date.now();
  let saved: CodeRepoBinding | null = null;
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const stored = await readStored();
    const existing = normalizeRepoBinding(stored[bindingKey(itemID)]);
    saved = {
      itemID,
      githubUrl: input.githubUrl,
      owner: input.owner,
      repo: input.repo,
      ...(input.branch ? { branch: input.branch } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    stored[bindingKey(itemID)] = saved;
    await writeStored(stored);
  });
  return writeQueue
    .then(() => ({ ok: true, binding: saved! }) as const)
    .catch((err) =>
      codeError(
        "STORAGE_FAILED",
        "保存 GitHub 仓库绑定失败。",
        err instanceof Error ? err.message : String(err),
      ),
    );
}

export async function loadCodeAnalysis(
  itemID: number | null,
): Promise<CodeResult<{ analysis: CodeAnalysisRecord }>> {
  if (itemID == null) {
    return codeError("NO_CURRENT_ITEM", "当前没有选中的 Zotero 条目。");
  }
  const stored = await readStored();
  const analysis = normalizeCodeAnalysis(stored[analysisKey(itemID)]);
  if (!analysis) {
    return codeError(
      "NO_SAVED_CODE_ANALYSIS",
      "当前 Zotero 条目还没有保存过代码分析。",
    );
  }
  return { ok: true, analysis };
}

export function saveCodeAnalysis(
  itemID: number | null,
  input: SaveCodeAnalysisInput,
  options: StorageOptions = {},
): Promise<CodeResult<{ analysis: CodeAnalysisRecord }>> {
  if (itemID == null) {
    return Promise.resolve(codeError("NO_CURRENT_ITEM", "当前没有选中的 Zotero 条目。"));
  }
  const now = options.now?.() ?? Date.now();
  let saved: CodeAnalysisRecord | null = null;
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const stored = await readStored();
    const existing = normalizeCodeAnalysis(stored[analysisKey(itemID)]);
    saved = {
      itemID,
      githubUrl: input.githubUrl,
      owner: input.owner,
      repo: input.repo,
      ...(input.branch ? { branch: input.branch } : {}),
      sections: input.sections.filter(Boolean),
      markdown: input.markdown,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    stored[analysisKey(itemID)] = saved;
    await writeStored(stored);
  });
  return writeQueue
    .then(() => ({ ok: true, analysis: saved! }) as const)
    .catch((err) =>
      codeError(
        "STORAGE_FAILED",
        "保存代码分析报告失败。",
        err instanceof Error ? err.message : String(err),
      ),
    );
}

export function codeAnalysisStoragePath(): string {
  return profileFilePath(getZotero().Profile.dir, CODE_ANALYSIS_FILE);
}

export function bindingKey(itemID: number): string {
  return `codeRepoBinding:${itemID}`;
}

export function analysisKey(itemID: number): string {
  return `codeAnalysis:${itemID}`;
}

async function readStored(): Promise<StoredCodeAnalysis> {
  try {
    const raw = await getZotero().File.getContentsAsync(
      codeAnalysisStoragePath(),
      "utf-8",
    );
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as StoredCodeAnalysis)
      : {};
  } catch {
    return {};
  }
}

async function writeStored(stored: StoredCodeAnalysis): Promise<void> {
  await getZotero().File.putContentsAsync(
    codeAnalysisStoragePath(),
    JSON.stringify(stored, null, 2),
  );
}

function normalizeRepoBinding(value: unknown): CodeRepoBinding | null {
  if (!isRecord(value)) return null;
  const itemID = numberValue(value.itemID);
  const githubUrl = stringValue(value.githubUrl);
  const owner = stringValue(value.owner);
  const repo = stringValue(value.repo);
  const createdAt = numberValue(value.createdAt);
  const updatedAt = numberValue(value.updatedAt);
  if (itemID == null || !githubUrl || !owner || !repo || createdAt == null || updatedAt == null) {
    return null;
  }
  const branch = stringValue(value.branch);
  return {
    itemID,
    githubUrl,
    owner,
    repo,
    ...(branch ? { branch } : {}),
    createdAt,
    updatedAt,
  };
}

function normalizeCodeAnalysis(value: unknown): CodeAnalysisRecord | null {
  if (!isRecord(value)) return null;
  const base = normalizeRepoBinding(value);
  const markdown = stringValue(value.markdown);
  if (!base || !markdown) return null;
  return {
    ...base,
    sections: Array.isArray(value.sections)
      ? value.sections.filter((entry): entry is string => typeof entry === "string")
      : [],
    markdown,
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getZotero(): ZoteroGlobal {
  return (globalThis as unknown as { Zotero: ZoteroGlobal }).Zotero;
}
