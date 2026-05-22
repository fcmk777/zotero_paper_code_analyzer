import { unzipSync } from "fflate";
import { classifyRepoFile, normalizeRepoPath } from "./file-classifier";
import type { RepoContextPolicy } from "./repo-policy";
import {
  repoError,
  type NormalizedGitHubRepo,
  type RepoFileMeta,
  type RepoModuleMap,
  type RepoResult,
  type RepoWorkspace,
  type RepoWorkspaceFile,
  type ResolvedRepoRef,
} from "./types";
import { extractSymbolSkeleton } from "./symbol-extractor";

export interface BuildWorkspaceInput {
  repo: NormalizedGitHubRepo;
  resolved: ResolvedRepoRef;
  archiveBytes: Uint8Array;
  policy: RepoContextPolicy;
  now?: () => number;
}

export function buildRepoWorkspaceFromArchive(
  input: BuildWorkspaceInput,
): RepoResult<{ workspace: RepoWorkspace }> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(input.archiveBytes);
  } catch (err) {
    return repoError(
      "ZIP_EXTRACT_FAILED",
      "GitHub archive 解压失败。",
      true,
      "请重试；如果持续失败，可能是代理返回了非 zip 内容。",
      err instanceof Error ? err.message : String(err),
    );
  }
  const workspaceId = workspaceIdFor(input.resolved);
  const manifest: RepoFileMeta[] = [];
  const files: Record<string, RepoWorkspaceFile> = {};
  const warnings: string[] = [];
  let indexedTextFiles = 0;
  let skippedBinaryFiles = 0;
  let skippedLargeFiles = 0;
  let skippedByIgnoreRules = 0;
  let totalTextBytes = 0;
  let totalFiles = 0;
  const stripped = stripArchiveTopLevel(entries);
  for (const [path, bytes] of Object.entries(stripped)) {
    if (!path || path.endsWith("/")) continue;
    totalFiles += 1;
    const classified = classifyRepoFile(path, bytes, input.policy);
    const meta = classified.meta;
    if (meta.isBinary) skippedBinaryFiles += 1;
    if (meta.skipReason === "single_file_too_large") skippedLargeFiles += 1;
    if (meta.skipReason?.startsWith("ignored_dir:")) skippedByIgnoreRules += 1;
    manifest.push(meta);
    const workspaceFile: RepoWorkspaceFile = { meta };
    if (classified.text && !meta.isSkipped) {
      const remaining = input.policy.maxExtractedTextBytes - totalTextBytes;
      if (remaining > 0) {
        const indexed = classified.text.slice(
          0,
          Math.min(input.policy.maxIndexedFileChars, remaining),
        );
        workspaceFile.content = indexed;
        workspaceFile.contentTruncated =
          indexed.length < classified.text.length;
        workspaceFile.symbolSkeleton = extractSymbolSkeleton(
          meta.path,
          indexed,
        );
        indexedTextFiles += 1;
        totalTextBytes += indexed.length;
      } else {
        workspaceFile.contentTruncated = true;
        warnings.push("文本索引总预算已用完，后续文本文件仅保留 manifest。");
      }
    }
    files[meta.path] = workspaceFile;
  }
  const sortedManifest = manifest.sort(
    (a, b) =>
      b.importanceScore - a.importanceScore || a.path.localeCompare(b.path),
  );
  const summary = summarizeWorkspace(
    workspaceId,
    input.resolved,
    sortedManifest,
    files,
    {
      totalEntries: Object.keys(entries).length,
      totalFiles,
      indexedTextFiles,
      skippedBinaryFiles,
      skippedLargeFiles,
      skippedByIgnoreRules,
      totalTextBytes,
      warnings,
      importedAt: input.now?.() ?? Date.now(),
    },
  );
  return {
    ok: true,
    workspace: {
      ...summary,
      manifest: sortedManifest,
      files,
      moduleMap: buildModuleMap(workspaceId, sortedManifest, warnings),
    },
  };
}

export function workspaceIdFor(resolved: ResolvedRepoRef): string {
  return `github:${resolved.owner}/${resolved.repo}@${resolved.commitSha || resolved.ref}`;
}

export function workspaceSummary(workspace: RepoWorkspace) {
  const {
    manifest: _manifest,
    files: _files,
    moduleMap: _moduleMap,
    ...summary
  } = workspace;
  return summary;
}

function stripArchiveTopLevel(
  entries: Record<string, Uint8Array>,
): Record<string, Uint8Array> {
  const paths = Object.keys(entries).filter(
    (path) => path && !path.endsWith("/"),
  );
  const firstSegments = new Set(paths.map((path) => path.split("/")[0]));
  if (firstSegments.size !== 1) return entries;
  const prefix = `${Array.from(firstSegments)[0]}/`;
  const stripped: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(entries)) {
    if (!path.startsWith(prefix)) continue;
    const next = normalizeRepoPath(path.slice(prefix.length));
    if (next) stripped[next] = bytes;
  }
  return stripped;
}

function summarizeWorkspace(
  workspaceId: string,
  resolved: ResolvedRepoRef,
  manifest: RepoFileMeta[],
  files: Record<string, RepoWorkspaceFile>,
  counts: {
    totalEntries: number;
    totalFiles: number;
    indexedTextFiles: number;
    skippedBinaryFiles: number;
    skippedLargeFiles: number;
    skippedByIgnoreRules: number;
    totalTextBytes: number;
    importedAt: number;
    warnings: string[];
  },
) {
  const languages: Record<string, number> = {};
  const topLevelDirs = new Set<string>();
  const readmePaths: string[] = [];
  const configPaths: string[] = [];
  const likelyEntryFiles: string[] = [];
  for (const meta of manifest) {
    languages[meta.language] = (languages[meta.language] ?? 0) + 1;
    const first = meta.path.split("/")[0];
    if (first && first !== meta.path) topLevelDirs.add(first);
    if (meta.roleTags.includes("readme")) readmePaths.push(meta.path);
    if (meta.roleTags.includes("config")) configPaths.push(meta.path);
    if (
      meta.roleTags.includes("training_entry") ||
      files[meta.path]?.symbolSkeleton?.symbols.some(
        (symbol) => symbol.kind === "entrypoint",
      )
    ) {
      likelyEntryFiles.push(meta.path);
    }
  }
  return {
    workspaceId,
    owner: resolved.owner,
    repo: resolved.repo,
    ref: resolved.ref,
    ...(resolved.commitSha ? { commitSha: resolved.commitSha } : {}),
    webUrl: resolved.webUrl,
    importedAt: counts.importedAt,
    totalEntries: counts.totalEntries,
    totalFiles: counts.totalFiles,
    indexedTextFiles: counts.indexedTextFiles,
    skippedBinaryFiles: counts.skippedBinaryFiles,
    skippedLargeFiles: counts.skippedLargeFiles,
    skippedByIgnoreRules: counts.skippedByIgnoreRules,
    totalTextBytes: counts.totalTextBytes,
    languages,
    topLevelDirs: Array.from(topLevelDirs).sort(),
    readmePaths: readmePaths.slice(0, 20),
    configPaths: configPaths.slice(0, 40),
    likelyEntryFiles: likelyEntryFiles.slice(0, 40),
    warnings: counts.warnings,
  };
}

export function buildModuleMap(
  workspaceId: string,
  manifest: RepoFileMeta[],
  warnings: string[],
): RepoModuleMap {
  const roleGroups: Record<string, string[]> = {};
  const topLevelDirs = new Set<string>();
  const languageStats: Record<string, number> = {};
  for (const meta of manifest) {
    languageStats[meta.language] = (languageStats[meta.language] ?? 0) + 1;
    const first = meta.path.split("/")[0];
    if (first && first !== meta.path) topLevelDirs.add(first);
    for (const tag of meta.roleTags) {
      const group = (roleGroups[tag] ??= []);
      if (group.length < 60) group.push(meta.path);
    }
  }
  const role = (tag: string) => roleGroups[tag] ?? [];
  return {
    workspaceId,
    topLevelDirs: Array.from(topLevelDirs).sort(),
    languageStats,
    roleGroups,
    likelyPipelines: {
      modelFiles: role("model_architecture").slice(0, 20),
      trainingFiles: role("training_entry").slice(0, 20),
      datasetFiles: role("dataset_pipeline").slice(0, 20),
      lossFiles: role("loss_objective").slice(0, 20),
      evalFiles: role("evaluation").slice(0, 20),
      configFiles: role("config").slice(0, 30),
    },
    entrypointCandidates: role("training_entry").slice(0, 30),
    warnings,
  };
}
