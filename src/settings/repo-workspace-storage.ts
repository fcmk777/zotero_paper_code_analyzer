import {
  repoError,
  type PaperContextDigest,
  type RepoAnalysisReport,
  type RepoResult,
  type RepoWorkspace,
} from "../context/repo/types";
import { profileFilePath } from "./profile-path";

interface StoredRepoWorkspaces {
  bindings?: Record<string, string>;
  workspaces?: Record<string, RepoWorkspace>;
  paperDigests?: Record<string, PaperContextDigest>;
  reports?: Record<string, RepoAnalysisReport>;
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

const REPO_WORKSPACE_FILE = "zotero-ai-sidebar-repo-workspaces.json";
let writeQueue: Promise<void> = Promise.resolve();

export async function saveRepoWorkspace(
  workspace: RepoWorkspace,
): Promise<RepoResult<{ workspace: RepoWorkspace }>> {
  try {
    await queuedWrite(async (stored) => {
      const workspaces = (stored.workspaces ??= {});
      workspaces[workspace.workspaceId] = workspace;
    });
    return { ok: true, workspace };
  } catch (err) {
    return storageError(
      "WORKSPACE_WRITE_FAILED",
      "保存 Repo Workspace 失败。",
      err,
    );
  }
}

export async function loadRepoWorkspace(
  workspaceId: string | undefined,
): Promise<RepoResult<{ workspace: RepoWorkspace }>> {
  if (!workspaceId) {
    return repoError(
      "NO_REPO_WORKSPACE",
      "当前 Zotero 条目还没有成功导入的 Repo Workspace。",
      true,
      "请先输入 GitHub URL 并点击“导入仓库并建立索引”。",
    );
  }
  const stored = await readStored();
  const workspace = stored.workspaces?.[workspaceId];
  if (!workspace) {
    return repoError(
      "NO_REPO_WORKSPACE",
      "已绑定的 Repo Workspace 缓存不存在或已损坏。",
      true,
      "请重新导入仓库并建立索引。",
    );
  }
  return { ok: true, workspace };
}

export async function bindRepoWorkspaceToItem(
  itemID: number | null,
  workspaceId: string,
): Promise<RepoResult<{ itemID: number; workspaceId: string }>> {
  if (itemID == null) {
    return repoError(
      "NO_CURRENT_ZOTERO_ITEM",
      "当前没有选中的 Zotero 条目。",
      true,
    );
  }
  try {
    await queuedWrite(async (stored) => {
      const bindings = (stored.bindings ??= {});
      bindings[bindingKey(itemID)] = workspaceId;
    });
    return { ok: true, itemID, workspaceId };
  } catch (err) {
    return storageError(
      "WORKSPACE_WRITE_FAILED",
      "保存当前条目的 workspace 绑定失败。",
      err,
    );
  }
}

export async function loadBoundRepoWorkspaceId(
  itemID: number | null,
): Promise<RepoResult<{ itemID: number; workspaceId: string }>> {
  if (itemID == null) {
    return repoError(
      "NO_CURRENT_ZOTERO_ITEM",
      "当前没有选中的 Zotero 条目。",
      true,
    );
  }
  const stored = await readStored();
  const workspaceId = stored.bindings?.[bindingKey(itemID)];
  if (!workspaceId) {
    return repoError(
      "NO_REPO_WORKSPACE",
      "当前 Zotero 条目还没有成功导入的 Repo Workspace。",
      true,
      "请先输入 GitHub URL 并点击“导入仓库并建立索引”。",
    );
  }
  return { ok: true, itemID, workspaceId };
}

export async function loadBoundRepoWorkspace(
  itemID: number | null,
): Promise<RepoResult<{ itemID: number; workspace: RepoWorkspace }>> {
  const binding = await loadBoundRepoWorkspaceId(itemID);
  if (!binding.ok) return binding;
  const workspace = await loadRepoWorkspace(binding.workspaceId);
  if (!workspace.ok) return workspace;
  return { ok: true, itemID: binding.itemID, workspace: workspace.workspace };
}

export async function savePaperContextDigest(
  digest: PaperContextDigest,
): Promise<RepoResult<{ digest: PaperContextDigest }>> {
  try {
    await queuedWrite(async (stored) => {
      const digests = (stored.paperDigests ??= {});
      digests[String(digest.itemID)] = digest;
    });
    return { ok: true, digest };
  } catch (err) {
    return storageError(
      "WORKSPACE_WRITE_FAILED",
      "保存论文上下文摘要失败。",
      err,
    );
  }
}

export async function loadPaperContextDigest(
  itemID: number | null,
): Promise<RepoResult<{ digest: PaperContextDigest }>> {
  if (itemID == null) {
    return repoError(
      "NO_CURRENT_ZOTERO_ITEM",
      "当前没有选中的 Zotero 条目。",
      true,
    );
  }
  const stored = await readStored();
  const digest = stored.paperDigests?.[String(itemID)];
  if (!digest) {
    return repoError(
      "NO_PAPER_CONTEXT_DIGEST",
      "当前 Zotero 条目还没有构建论文上下文摘要。",
      true,
      "请先调用 paper_build_context_digest。",
    );
  }
  return { ok: true, digest };
}

export async function saveRepoAnalysisReport(
  itemID: number | null,
  workspace: RepoWorkspace,
  input: { markdown: string; sections: string[] },
  options: StorageOptions = {},
): Promise<RepoResult<{ report: RepoAnalysisReport }>> {
  if (itemID == null) {
    return repoError(
      "NO_CURRENT_ZOTERO_ITEM",
      "当前没有选中的 Zotero 条目。",
      true,
    );
  }
  const markdown = input.markdown.trim();
  if (!markdown) {
    return repoError(
      "WORKSPACE_WRITE_FAILED",
      "保存分析报告需要非空 Markdown。",
      true,
    );
  }
  const key = reportKey(itemID, workspace.workspaceId);
  const now = options.now?.() ?? Date.now();
  let saved: RepoAnalysisReport | null = null;
  try {
    await queuedWrite(async (stored) => {
      const reports = (stored.reports ??= {});
      const existing = reports[key];
      saved = {
        itemID,
        workspaceId: workspace.workspaceId,
        githubUrl: `https://github.com/${workspace.owner}/${workspace.repo}`,
        owner: workspace.owner,
        repo: workspace.repo,
        ref: workspace.ref,
        ...(workspace.commitSha ? { commitSha: workspace.commitSha } : {}),
        sections: input.sections.filter(Boolean),
        markdown,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      reports[key] = saved;
    });
    return { ok: true, report: saved! };
  } catch (err) {
    return storageError(
      "WORKSPACE_WRITE_FAILED",
      "保存代码讲解报告失败。",
      err,
    );
  }
}

export async function loadRepoAnalysisReport(
  itemID: number | null,
  workspaceId?: string,
): Promise<RepoResult<{ report: RepoAnalysisReport }>> {
  if (itemID == null) {
    return repoError(
      "NO_CURRENT_ZOTERO_ITEM",
      "当前没有选中的 Zotero 条目。",
      true,
    );
  }
  const stored = await readStored();
  const targetWorkspaceId =
    workspaceId ?? stored.bindings?.[bindingKey(itemID)] ?? "";
  const report = stored.reports?.[reportKey(itemID, targetWorkspaceId)];
  if (!report) {
    return repoError(
      "NO_SAVED_CODE_ANALYSIS",
      "当前论文和当前 workspace 还没有保存过代码讲解报告。",
      true,
      "请先生成代码讲解并保存。",
    );
  }
  return { ok: true, report };
}

export function repoWorkspaceStoragePath(): string {
  return profileFilePath(getZotero().Profile.dir, REPO_WORKSPACE_FILE);
}

export function bindingKey(itemID: number): string {
  return `repoWorkspaceBinding:${itemID}`;
}

export function reportKey(itemID: number, workspaceId: string): string {
  return `repoAnalysisReport:${itemID}:${workspaceId}`;
}

async function queuedWrite(
  updater: (stored: StoredRepoWorkspaces) => void,
): Promise<void> {
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      const stored = await readStored();
      updater(stored);
      await writeStored(stored);
    });
  await writeQueue;
}

async function readStored(): Promise<StoredRepoWorkspaces> {
  try {
    const raw = await getZotero().File.getContentsAsync(
      repoWorkspaceStoragePath(),
      "utf-8",
    );
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return parsed as StoredRepoWorkspaces;
  } catch {
    return {};
  }
}

async function writeStored(stored: StoredRepoWorkspaces): Promise<void> {
  await getZotero().File.putContentsAsync(
    repoWorkspaceStoragePath(),
    JSON.stringify(stored, null, 2),
  );
}

function storageError(code: string, message: string, err: unknown) {
  return repoError(
    code,
    message,
    true,
    undefined,
    err instanceof Error ? err.message : String(err),
  );
}

function getZotero(): ZoteroGlobal {
  return (globalThis as unknown as { Zotero: ZoteroGlobal }).Zotero;
}
