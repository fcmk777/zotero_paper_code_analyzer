import type { AgentTool, ToolExecutionResult } from "../../providers/types";
import type { ContextSource, ItemMetadata } from "../builder";
import { downloadGitHubArchive, resolveGitHubRef } from "./github-client";
import { normalizeGitHubRepoUrl } from "./github-url";
import { readFileSliceWithLineNumbers } from "./line-number";
import {
  buildRepoWorkspaceFromArchive,
  workspaceIdFor,
  workspaceSummary,
} from "./repo-indexer";
import { DEFAULT_REPO_POLICY, type RepoContextPolicy } from "./repo-policy";
import { formatSymbolSkeleton } from "./symbol-extractor";
import {
  repoError,
  type PaperContextDigest,
  type PaperContextSection,
  type RepoFileMeta,
  type RepoResult,
  type RepoToolError,
  type RepoWorkspace,
} from "./types";
import {
  bindRepoWorkspaceToItem,
  loadBoundRepoWorkspace,
  loadPaperContextDigest,
  loadRepoAnalysisReport,
  loadRepoWorkspace,
  savePaperContextDigest,
  saveRepoAnalysisReport,
  saveRepoWorkspace,
} from "../../settings/repo-workspace-storage";

export interface RepoToolFactoryOptions {
  itemID: number | null;
  source?: ContextSource;
  policy?: RepoContextPolicy;
  fetchImpl?: typeof fetch;
  githubToken?: string;
}

export function createRepoWorkspaceTools(
  options: RepoToolFactoryOptions,
): AgentTool[] {
  const policy = options.policy ?? DEFAULT_REPO_POLICY;
  return [
    {
      name: "repo_import_github_archive",
      description:
        "Import a public GitHub repository archive into a local Repo Workspace for paper-code analysis. This downloads zipball archive, extracts it locally, scans all text files, builds manifest/module map/symbol skeleton, then binds the successful workspace to the current Zotero item.",
      parameters: objectSchema(
        {
          githubUrl: stringSchema(
            "GitHub repository URL, tree URL, blob URL, or git@github.com:owner/repo.git.",
          ),
          ref: stringSchema(
            "Optional branch, tag, or commit sha. Overrides URL ref when provided.",
          ),
          forceReimport: booleanSchema(
            "If true, rebuild the workspace even when cached.",
          ),
        },
        ["githubUrl"],
      ),
      execute: async (args) =>
        safeExecute(async () => {
          const itemID = currentItemID(options);
          if (itemID == null) {
            return errorResult(
              repoError(
                "NO_CURRENT_ZOTERO_ITEM",
                "当前没有选中的 Zotero 条目，无法绑定导入结果。",
                true,
                "请先在 Zotero 中选中或打开一篇论文。",
              ),
            );
          }
          const parsed = objectArgs(args);
          const url = stringArg(parsed, "githubUrl");
          const ref = stringArg(parsed, "ref");
          const normalized = normalizeGitHubRepoUrl(url, ref || undefined);
          if (!normalized.ok) return errorResult(normalized);
          const resolved = await resolveGitHubRef(
            normalized,
            ref || normalized.ref,
            githubOptions(options, policy),
          );
          if (!resolved.ok) return errorResult(resolved);
          const workspaceId = workspaceIdFor(resolved.resolved);
          if (!booleanArg(parsed, "forceReimport")) {
            const cached = await loadRepoWorkspace(workspaceId);
            if (cached.ok) {
              await bindRepoWorkspaceToItem(itemID, workspaceId);
              return jsonResult(
                {
                  ok: true,
                  ...workspaceSummary(cached.workspace),
                  itemID,
                  cached: true,
                  message: "已复用本地 Repo Workspace 缓存并绑定到当前论文。",
                },
                `复用 Repo Workspace: ${cached.workspace.owner}/${cached.workspace.repo}`,
              );
            }
          }
          const archive = await downloadGitHubArchive(
            resolved.resolved,
            githubOptions(options, policy),
          );
          if (!archive.ok) return errorResult(archive);
          const built = buildRepoWorkspaceFromArchive({
            repo: normalized,
            resolved: resolved.resolved,
            archiveBytes: archive.bytes,
            policy,
          });
          if (!built.ok) return errorResult(built);
          const saved = await saveRepoWorkspace(built.workspace);
          if (!saved.ok) return errorResult(saved);
          const bound = await bindRepoWorkspaceToItem(
            itemID,
            saved.workspace.workspaceId,
          );
          if (!bound.ok) return errorResult(bound);
          return jsonResult(
            {
              ok: true,
              ...workspaceSummary(saved.workspace),
              itemID,
              cached: false,
              message:
                "已导入 GitHub archive，完成本地扫描和索引，并绑定到当前论文。",
            },
            `导入仓库并建立索引：${saved.workspace.indexedTextFiles}/${saved.workspace.totalFiles} 个文本文件`,
          );
        }),
    },
    {
      name: "repo_get_workspace_status",
      description:
        "Read the current Zotero item's imported Repo Workspace status: owner/repo/ref, file counts, language distribution, warnings, and cache id. Use before code analysis.",
      parameters: objectSchema({}),
      execute: async () =>
        safeExecute(async () => {
          const loaded = await loadBoundWorkspace(options);
          if (!loaded.ok) return errorResult(loaded);
          return jsonResult(
            {
              ok: true,
              itemID: loaded.itemID,
              ...workspaceSummary(loaded.workspace),
            },
            `读取工程索引状态：${loaded.workspace.owner}/${loaded.workspace.repo}`,
          );
        }),
    },
    {
      name: "repo_get_manifest",
      description:
        "Return a bounded manifest summary for the current Repo Workspace. Filter by roleTags, language, or pathPrefix to inspect indexed files without reading full source.",
      parameters: objectSchema({
        roleTags: arraySchema(
          "Optional role tags such as model_architecture, training_entry, dataset_pipeline, loss_objective, config.",
        ),
        language: stringSchema(
          "Optional language filter, e.g. python, markdown, yaml.",
        ),
        pathPrefix: stringSchema("Optional repository path prefix."),
        limit: numberSchema("Maximum entries returned; clamped by policy."),
      }),
      execute: async (args) =>
        safeExecute(async () => {
          const loaded = await loadBoundWorkspace(options);
          if (!loaded.ok) return errorResult(loaded);
          const parsed = objectArgs(args);
          const roleTags = stringArrayArg(parsed, "roleTags");
          const language = stringArg(parsed, "language");
          const pathPrefix = stringArg(parsed, "pathPrefix");
          const limit = clamp(
            Math.floor(
              numberArg(parsed, "limit") ?? policy.maxManifestEntriesReturned,
            ),
            1,
            policy.maxManifestEntriesReturned,
          );
          const entries = loaded.workspace.manifest
            .filter(
              (meta) =>
                !roleTags.length ||
                roleTags.some((tag) => meta.roleTags.includes(tag as never)),
            )
            .filter((meta) => !language || meta.language === language)
            .filter((meta) => !pathPrefix || meta.path.startsWith(pathPrefix))
            .slice(0, limit)
            .map(manifestEntryForOutput);
          return jsonResult(
            {
              ok: true,
              workspaceId: loaded.workspace.workspaceId,
              totalMatched: entries.length,
              entries,
              truncated: entries.length === limit,
            },
            `读取 manifest 摘要 ${entries.length} 项`,
          );
        }),
    },
    {
      name: "repo_get_module_map",
      description:
        "Return the Repo Workspace module map: top-level dirs, language stats, role groups, likely model/train/data/loss/eval/config pipeline files. Use before reading individual source files.",
      parameters: objectSchema({}),
      execute: async () =>
        safeExecute(async () => {
          const loaded = await loadBoundWorkspace(options);
          if (!loaded.ok) return errorResult(loaded);
          return jsonResult(
            { ok: true, moduleMap: loaded.workspace.moduleMap },
            "读取工程模块图",
          );
        }),
    },
    {
      name: "repo_get_symbol_skeleton",
      description:
        "Return symbol skeletons for important indexed files: imports, classes, functions, entrypoints, config keys, and notebook headings. This is a global code map, not full source.",
      parameters: objectSchema({
        roleTags: arraySchema("Optional role tags to limit skeletons."),
        limit: numberSchema("Maximum files returned."),
      }),
      execute: async (args) =>
        safeExecute(async () => {
          const loaded = await loadBoundWorkspace(options);
          if (!loaded.ok) return errorResult(loaded);
          const parsed = objectArgs(args);
          const roleTags = stringArrayArg(parsed, "roleTags");
          const limit = clamp(
            Math.floor(numberArg(parsed, "limit") ?? 40),
            1,
            100,
          );
          const skeletons = loaded.workspace.manifest
            .filter((meta) => !meta.isSkipped)
            .filter(
              (meta) =>
                !roleTags.length ||
                roleTags.some((tag) => meta.roleTags.includes(tag as never)),
            )
            .slice(0, limit)
            .map((meta) => loaded.workspace.files[meta.path]?.symbolSkeleton)
            .filter(Boolean)
            .map((skeleton) => formatSymbolSkeleton(skeleton!));
          const markdown = truncateText(
            skeletons.join("\n\n"),
            policy.maxSymbolSkeletonChars,
          );
          return jsonResult(
            {
              ok: true,
              workspaceId: loaded.workspace.workspaceId,
              skeletonMarkdown: markdown.text,
              truncated: markdown.truncated,
            },
            `读取符号骨架 ${skeletons.length} 个文件`,
          );
        }),
    },
    {
      name: "repo_search_files",
      description:
        "Search current Repo Workspace by query terms, file paths, role tags, symbol names, and indexed snippets. Use to locate relevant files/classes/functions before precise line reads.",
      parameters: objectSchema(
        {
          query: stringSchema(
            "Keywords, class names, function names, paper method terms, or file path fragments.",
          ),
          roleTags: arraySchema("Optional role tags to boost/filter results."),
          limit: numberSchema("Maximum results returned."),
        },
        ["query"],
      ),
      execute: async (args) =>
        safeExecute(async () => {
          const loaded = await loadBoundWorkspace(options);
          if (!loaded.ok) return errorResult(loaded);
          const parsed = objectArgs(args);
          const query = stringArg(parsed, "query");
          if (!query)
            return errorResult(
              repoError(
                "INVALID_ARGUMENT",
                "repo_search_files 需要非空 query。",
                true,
              ),
            );
          const results = searchWorkspace(
            loaded.workspace,
            query,
            stringArrayArg(parsed, "roleTags"),
            clamp(
              Math.floor(numberArg(parsed, "limit") ?? policy.maxSearchResults),
              1,
              policy.maxSearchResults,
            ),
          );
          return jsonResult(
            { ok: true, query, results },
            `搜索工程索引，命中 ${results.length} 个文件`,
          );
        }),
    },
    {
      name: "repo_read_file_with_lines",
      description:
        "Read one indexed text file from the local Repo Workspace with stable real line numbers. Supports startLine/endLine. Code evidence in reports must cite only paths and line numbers returned by this tool or repo_read_related_files.",
      parameters: objectSchema(
        {
          path: stringSchema("Repository-relative file path."),
          startLine: numberSchema("Optional 1-based start line."),
          endLine: numberSchema("Optional 1-based end line."),
          includeContext: booleanSchema(
            "Reserved for future expansion; currently ignored.",
          ),
        },
        ["path"],
      ),
      execute: async (args) =>
        safeExecute(async () => {
          const loaded = await loadBoundWorkspace(options);
          if (!loaded.ok) return errorResult(loaded);
          const parsed = objectArgs(args);
          const path = stringArg(parsed, "path");
          const file = path ? loaded.workspace.files[path] : undefined;
          if (!file) {
            return errorResult(
              repoError(
                "FILE_READ_FAILED",
                `未在 workspace 中找到文件：${path}`,
                true,
              ),
            );
          }
          if (!file.content || file.meta.isSkipped) {
            return errorResult(
              repoError(
                file.meta.isBinary ? "BINARY_FILE_SKIPPED" : "FILE_READ_FAILED",
                `该文件没有可读取的本地文本内容：${path}`,
                true,
                "它可能是二进制、超大文件、被忽略目录或超过索引预算。",
                file.meta,
              ),
            );
          }
          const slice = readFileSliceWithLineNumbers(
            path,
            file.content,
            policy,
            numberArg(parsed, "startLine") ?? 1,
            numberArg(parsed, "endLine") ?? undefined,
          );
          return jsonResult(
            {
              ok: true,
              workspaceId: loaded.workspace.workspaceId,
              file: slice,
            },
            `读取源码 ${path} L${slice.returnedLines}`,
          );
        }),
    },
    {
      name: "repo_read_related_files",
      description:
        "Read the most important files for a role tag from the local Repo Workspace with stable line numbers. Use for model_architecture, training_entry, dataset_pipeline, loss_objective, evaluation, inference, config.",
      parameters: objectSchema(
        {
          role: stringSchema(
            "Role tag, e.g. model_architecture, training_entry, dataset_pipeline, loss_objective, config.",
          ),
          limit: numberSchema("Maximum files to read."),
        },
        ["role"],
      ),
      execute: async (args) =>
        safeExecute(async () => {
          const loaded = await loadBoundWorkspace(options);
          if (!loaded.ok) return errorResult(loaded);
          const parsed = objectArgs(args);
          const role = stringArg(parsed, "role");
          const limit = clamp(
            Math.floor(
              numberArg(parsed, "limit") ?? policy.maxReadRelatedFiles,
            ),
            1,
            policy.maxReadRelatedFiles,
          );
          const files = loaded.workspace.manifest
            .filter((meta) => meta.roleTags.includes(role as never))
            .filter((meta) => !!loaded.workspace.files[meta.path]?.content)
            .slice(0, limit);
          if (!files.length) {
            return errorResult(
              repoError(
                "NO_RELEVANT_FILES",
                `没有找到 role=${role} 且可读取的本地文本文件。`,
                true,
              ),
            );
          }
          const slices = files.map((meta) =>
            readFileSliceWithLineNumbers(
              meta.path,
              loaded.workspace.files[meta.path]!.content!,
              policy,
              1,
              undefined,
            ),
          );
          return jsonResult(
            {
              ok: true,
              workspaceId: loaded.workspace.workspaceId,
              role,
              files: slices,
            },
            `按角色读取源码 ${role}: ${slices.length} 个文件`,
          );
        }),
    },
    {
      name: "paper_build_context_digest",
      description:
        "Build and save a bounded digest for the current Zotero paper: metadata, abstract, section outline, method/experiment keywords, and annotation summary. Use before aligning paper claims with code.",
      parameters: objectSchema({
        forceRebuild: booleanSchema(
          "If true, rebuild digest even when cached.",
        ),
        includeAnnotations: booleanSchema(
          "Whether to include Zotero annotations summary.",
        ),
      }),
      execute: async (args) =>
        safeExecute(async () => {
          const itemID = currentItemID(options);
          if (itemID == null) {
            return errorResult(
              repoError(
                "NO_CURRENT_ZOTERO_ITEM",
                "当前没有选中的 Zotero 条目。",
                true,
              ),
            );
          }
          const parsed = objectArgs(args);
          if (!booleanArg(parsed, "forceRebuild")) {
            const cached = await loadPaperContextDigest(itemID);
            if (cached.ok) {
              return jsonResult(
                {
                  ok: true,
                  digest: digestForOutput(cached.digest),
                  cached: true,
                },
                `复用论文上下文摘要：${cached.digest.title}`,
              );
            }
          }
          const digest = await buildPaperDigest(
            options,
            policy,
            itemID,
            booleanArg(parsed, "includeAnnotations") !== false,
          );
          if (!digest.ok) return errorResult(digest);
          const saved = await savePaperContextDigest(digest.digest);
          if (!saved.ok) return errorResult(saved);
          return jsonResult(
            { ok: true, digest: digestForOutput(saved.digest), cached: false },
            `构建论文上下文摘要：${saved.digest.availableTextChars} 字`,
          );
        }),
    },
    {
      name: "paper_get_context_digest",
      description:
        "Read the saved paper context digest for the current Zotero item. If absent, call paper_build_context_digest.",
      parameters: objectSchema({}),
      execute: async () =>
        safeExecute(async () => {
          const loaded = await loadPaperContextDigest(currentItemID(options));
          if (!loaded.ok) return errorResult(loaded);
          return jsonResult(
            { ok: true, digest: digestForOutput(loaded.digest) },
            `读取论文上下文摘要：${loaded.digest.title}`,
          );
        }),
    },
    {
      name: "paper_search_sections",
      description:
        "Search saved current-paper digest sections by query and return relevant paper passages. Use to align method/experiment text with code evidence.",
      parameters: objectSchema(
        {
          query: stringSchema("Paper-side keywords to search."),
          limit: numberSchema("Maximum sections/passages returned."),
        },
        ["query"],
      ),
      execute: async (args) =>
        safeExecute(async () => {
          const loaded = await loadPaperContextDigest(currentItemID(options));
          if (!loaded.ok) return errorResult(loaded);
          const parsed = objectArgs(args);
          const query = stringArg(parsed, "query");
          const limit = clamp(
            Math.floor(numberArg(parsed, "limit") ?? 5),
            1,
            12,
          );
          const results = searchPaperSections(loaded.digest, query, limit);
          return jsonResult(
            { ok: true, query, results },
            `搜索论文段落，命中 ${results.length} 段`,
          );
        }),
    },
    {
      name: "paper_read_section",
      description:
        "Read a saved current-paper section by title substring within a bounded character budget.",
      parameters: objectSchema(
        {
          sectionTitle: stringSchema(
            "Section title substring, e.g. Method, Experiments, Results.",
          ),
          charBudget: numberSchema("Maximum characters returned."),
        },
        ["sectionTitle"],
      ),
      execute: async (args) =>
        safeExecute(async () => {
          const loaded = await loadPaperContextDigest(currentItemID(options));
          if (!loaded.ok) return errorResult(loaded);
          const parsed = objectArgs(args);
          const title = stringArg(parsed, "sectionTitle");
          const budget = clamp(
            Math.floor(
              numberArg(parsed, "charBudget") ?? policy.maxPaperSectionChars,
            ),
            1000,
            policy.maxPaperSectionChars,
          );
          const section = loaded.digest.sectionOutline.find((candidate) =>
            candidate.title.toLowerCase().includes(title.toLowerCase()),
          );
          if (!section?.text) {
            return errorResult(
              repoError("NO_PAPER_SECTION", `没有找到论文章节：${title}`, true),
            );
          }
          const text = truncateText(section.text, budget);
          return jsonResult(
            {
              ok: true,
              section: {
                title: section.title,
                startOffset: section.startOffset,
                endOffset: section.endOffset,
                text: text.text,
                truncated: text.truncated,
              },
            },
            `读取论文章节 ${section.title} ${text.text.length} 字`,
          );
        }),
    },
    {
      name: "analysis_save_report",
      description:
        "Save the generated Markdown paper-code report for the current Zotero item and current Repo Workspace. Use after the user-requested report is complete.",
      requiresApproval: true,
      parameters: objectSchema(
        {
          analysisMarkdown: stringSchema("Complete Markdown report to save."),
          sections: arraySchema("Analysis dimensions included in the report."),
        },
        ["analysisMarkdown"],
      ),
      execute: async (args) =>
        safeExecute(async () => {
          const loaded = await loadBoundWorkspace(options);
          if (!loaded.ok) return errorResult(loaded);
          const parsed = objectArgs(args);
          const markdown = stringArg(parsed, "analysisMarkdown");
          const saved = await saveRepoAnalysisReport(
            loaded.itemID,
            loaded.workspace,
            {
              markdown,
              sections: stringArrayArg(parsed, "sections"),
            },
          );
          if (!saved.ok) return errorResult(saved);
          return jsonResult(
            {
              ok: true,
              itemID: saved.report.itemID,
              workspaceId: saved.report.workspaceId,
              markdownChars: saved.report.markdown.length,
              createdAt: saved.report.createdAt,
              updatedAt: saved.report.updatedAt,
              message: "已保存当前论文的代码讲解报告。",
            },
            `保存代码讲解报告 ${saved.report.markdown.length} 字`,
          );
        }),
    },
    {
      name: "analysis_get_saved_report",
      description:
        "Read the saved paper-code Markdown report for the current Zotero item and current Repo Workspace.",
      parameters: objectSchema({}),
      execute: async () =>
        safeExecute(async () => {
          const binding = await loadBoundWorkspace(options);
          if (!binding.ok) return errorResult(binding);
          const loaded = await loadRepoAnalysisReport(
            binding.itemID,
            binding.workspace.workspaceId,
          );
          if (!loaded.ok) return errorResult(loaded);
          return jsonResult(
            { ok: true, report: loaded.report },
            `读取已保存代码讲解报告 ${loaded.report.markdown.length} 字`,
          );
        }),
    },
  ];
}

async function loadBoundWorkspace(
  options: RepoToolFactoryOptions,
): Promise<RepoResult<{ itemID: number; workspace: RepoWorkspace }>> {
  return loadBoundRepoWorkspace(currentItemID(options));
}

async function buildPaperDigest(
  options: RepoToolFactoryOptions,
  policy: RepoContextPolicy,
  itemID: number,
  includeAnnotations: boolean,
): Promise<RepoResult<{ digest: PaperContextDigest }>> {
  if (!options.source) {
    return repoError(
      "NO_PAPER_CONTEXT_SOURCE",
      "当前环境没有可用的 Zotero 论文上下文源。",
      true,
    );
  }
  const metadata = await options.source.getItem(itemID);
  if (!metadata) {
    return repoError(
      "NO_CURRENT_ZOTERO_ITEM",
      "无法读取当前 Zotero 条目元数据。",
      true,
    );
  }
  const fullText = await options.source.getFullText(itemID).catch(() => "");
  const sections = sectionDigest(fullText, policy);
  const annotations =
    includeAnnotations && options.source.getAnnotations
      ? await options.source.getAnnotations(itemID).catch(() => [])
      : [];
  const digest: PaperContextDigest = {
    itemID,
    title: metadata.title,
    authors: metadata.authors,
    ...(metadata.year ? { year: String(metadata.year) } : {}),
    ...(metadata.abstract ? { abstract: metadata.abstract } : {}),
    sectionOutline: sections,
    methodKeywords: keywordsFromText(
      [
        metadata.title,
        metadata.abstract ?? "",
        sections
          .filter((section) =>
            /method|approach|model|architecture|framework/i.test(section.title),
          )
          .map((section) => section.summary ?? "")
          .join(" "),
      ].join(" "),
      24,
    ),
    experimentKeywords: keywordsFromText(
      sections
        .filter((section) =>
          /experiment|result|ablation|evaluation/i.test(section.title),
        )
        .map((section) => section.summary ?? "")
        .join(" "),
      20,
    ),
    ...(annotations.length
      ? {
          annotationsSummary: annotations
            .slice(0, 80)
            .map((annotation) =>
              [
                annotation.pageLabel ? `p.${annotation.pageLabel}` : "",
                annotation.text,
                annotation.comment,
              ]
                .filter(Boolean)
                .join(" | "),
            )
            .join("\n")
            .slice(0, 12_000),
        }
      : {}),
    availableTextChars: fullText.length,
    warnings: fullText
      ? []
      : ["没有读取到 PDF 全文文本，digest 仅包含元数据、摘要和标注。"],
  };
  return { ok: true, digest };
}

function sectionDigest(
  fullText: string,
  policy: RepoContextPolicy,
): PaperContextSection[] {
  const text = fullText.replace(/\r\n?/g, "\n");
  if (!text.trim()) return [];
  const matches = Array.from(
    text.matchAll(
      /(?:^|\n)\s*((?:abstract|introduction|related work|background|method|methods|approach|model|experiments?|results?|ablation|evaluation|conclusion|discussion|limitations)\b[^\n]{0,80})/gi,
    ),
  );
  const offsets = matches
    .map((match) => ({
      title: normalizeWhitespace(match[1]),
      startOffset: match.index ?? 0,
    }))
    .filter(
      (entry, index, list) =>
        index === 0 || entry.startOffset - list[index - 1].startOffset > 500,
    );
  if (!offsets.length) {
    const slice = truncateText(text, policy.maxPaperDigestChars);
    return [
      {
        title: "Full Text",
        startOffset: 0,
        endOffset: slice.text.length,
        summary: summarizeText(slice.text),
        text: slice.text,
      },
    ];
  }
  return offsets.slice(0, 24).map((entry, index) => {
    const next = offsets[index + 1]?.startOffset ?? text.length;
    const raw = text.slice(entry.startOffset, next);
    const limited = truncateText(raw, policy.maxPaperSectionChars);
    return {
      title: entry.title,
      startOffset: entry.startOffset,
      endOffset: next,
      summary: summarizeText(limited.text),
      text: limited.text,
    };
  });
}

function searchWorkspace(
  workspace: RepoWorkspace,
  query: string,
  roleTags: string[],
  limit: number,
) {
  const terms = queryTerms(query);
  return workspace.manifest
    .map((meta) => {
      const file = workspace.files[meta.path];
      const haystack = [
        meta.path,
        meta.language,
        meta.roleTags.join(" "),
        file?.symbolSkeleton?.symbols.map((symbol) => symbol.name).join(" ") ??
          "",
      ]
        .join(" ")
        .toLowerCase();
      const matchedTerms = terms.filter((term) => haystack.includes(term));
      const roleBoost = roleTags.filter((tag) =>
        meta.roleTags.includes(tag as never),
      );
      const contentMatches = file?.content
        ? snippetMatches(file.content, terms, 3)
        : [];
      const score =
        meta.importanceScore +
        matchedTerms.length * 15 +
        roleBoost.length * 20 +
        contentMatches.length * 8;
      return {
        path: meta.path,
        score,
        language: meta.language,
        roleTags: meta.roleTags,
        matchedTerms,
        snippetLines: contentMatches,
      };
    })
    .filter(
      (result) =>
        result.matchedTerms.length ||
        result.snippetLines.length ||
        roleTags.some((tag) => result.roleTags.includes(tag as never)),
    )
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit);
}

function snippetMatches(content: string, terms: string[], limit: number) {
  const lines = content.split("\n");
  const matches: Array<{ line: number; text: string; matchedTerms: string[] }> =
    [];
  lines.forEach((line, index) => {
    if (matches.length >= limit) return;
    const lower = line.toLowerCase();
    const matched = terms.filter((term) => lower.includes(term));
    if (matched.length) {
      matches.push({
        line: index + 1,
        text: line.trim().slice(0, 220),
        matchedTerms: matched,
      });
    }
  });
  return matches;
}

function searchPaperSections(
  digest: PaperContextDigest,
  query: string,
  limit: number,
) {
  const terms = queryTerms(query);
  return digest.sectionOutline
    .map((section) => {
      const text = [section.title, section.summary, section.text].join(" ");
      const lower = text.toLowerCase();
      const matchedTerms = terms.filter((term) => lower.includes(term));
      return {
        title: section.title,
        startOffset: section.startOffset,
        endOffset: section.endOffset,
        matchedTerms,
        snippet: (section.text || section.summary || "").slice(0, 2000),
        score: matchedTerms.length * 10,
      };
    })
    .filter((section) => section.matchedTerms.length)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function digestForOutput(digest: PaperContextDigest): PaperContextDigest {
  return {
    ...digest,
    sectionOutline: digest.sectionOutline.map((section) => ({
      title: section.title,
      startOffset: section.startOffset,
      endOffset: section.endOffset,
      summary: section.summary,
    })),
  };
}

function manifestEntryForOutput(meta: RepoFileMeta) {
  return {
    path: meta.path,
    language: meta.language,
    sizeBytes: meta.sizeBytes,
    lineCount: meta.lineCount,
    isSkipped: meta.isSkipped,
    skipReason: meta.skipReason,
    importanceScore: meta.importanceScore,
    importanceReasons: meta.importanceReasons,
    roleTags: meta.roleTags,
    lfsPointer: meta.lfsPointer,
  };
}

function jsonResult(value: unknown, summary: string): ToolExecutionResult {
  return {
    output: JSON.stringify(value, null, 2),
    summary,
    context: { planMode: "code_repository", sourceKind: "github" },
  };
}

function errorResult(error: RepoToolError): ToolExecutionResult {
  return jsonResult(
    error,
    String(error.message || "Repo Workspace 工具执行失败。"),
  );
}

async function safeExecute(
  fn: () => Promise<ToolExecutionResult>,
): Promise<ToolExecutionResult> {
  try {
    return await fn();
  } catch (err) {
    return errorResult(
      repoError(
        "UNKNOWN_ERROR",
        "Repo Workspace 工具发生未知错误。",
        true,
        undefined,
        err instanceof Error ? err.message : String(err),
      ),
    );
  }
}

function githubOptions(
  options: RepoToolFactoryOptions,
  policy: RepoContextPolicy,
) {
  return {
    policy,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.githubToken ? { token: options.githubToken } : {}),
  };
}

function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function stringSchema(description: string): Record<string, unknown> {
  return { type: "string", description };
}

function numberSchema(description: string): Record<string, unknown> {
  return { type: "number", description };
}

function booleanSchema(description: string): Record<string, unknown> {
  return { type: "boolean", description };
}

function arraySchema(description: string): Record<string, unknown> {
  return {
    type: "array",
    description,
    items: { type: "string" },
  };
}

function objectArgs(args: unknown): Record<string, unknown> {
  return args && typeof args === "object"
    ? (args as Record<string, unknown>)
    : {};
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function numberArg(args: Record<string, unknown>, key: string): number | null {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanArg(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true;
}

function stringArrayArg(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function currentItemID(options: RepoToolFactoryOptions): number | null {
  return typeof options.itemID === "number" ? options.itemID : null;
}

function truncateText(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  return text.length > maxChars
    ? { text: text.slice(0, maxChars), truncated: true }
    : { text, truncated: false };
}

function queryTerms(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[\s,;:，。；：/\\|()[\]{}"'`<>]+/)
        .map((part) => part.trim())
        .filter((part) => part.length >= 2),
    ),
  );
}

function keywordsFromText(text: string, limit: number): string[] {
  const counts = new Map<string, number>();
  for (const term of queryTerms(text)) {
    if (/^\d+$/.test(term) || term.length < 3) continue;
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term]) => term);
}

function summarizeText(text: string): string {
  return normalizeWhitespace(text).slice(0, 1000);
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
