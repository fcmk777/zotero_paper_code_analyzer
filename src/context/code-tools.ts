import type { AgentTool, ToolExecutionResult } from "../providers/types";
import {
  loadCodeAnalysis,
  loadCodeRepoBinding,
  saveCodeAnalysis,
  saveCodeRepoBinding,
} from "../settings/code-analysis-storage";
import type { ContextSource } from "./builder";
import {
  DEFAULT_CODE_CONTEXT_POLICY,
  type CodeContextPolicy,
} from "./code-policy";
import {
  filterRepoTreeFiles,
  formatFileRangeWithLineNumbers,
  formatFilesWithLineNumbers,
  isAllowedSourcePath,
  isLikelyBinaryContent,
  searchSourceContent,
  selectRelevantFiles,
  type ScoredRepoFile,
} from "./code-file-select";
import {
  codeError,
  fetchDefaultBranch,
  fetchRepoTree,
  normalizeGitHubUrl,
  readGitHubFile,
  readRepositoryReadme,
  type CodeResult,
  type ParsedGitHubRepo,
} from "./code-github";

export interface CodeToolFactoryOptions {
  itemID: number | null;
  source?: ContextSource;
  policy?: CodeContextPolicy;
  fetchImpl?: typeof fetch;
  githubToken?: string;
}

interface ResolvedRepository extends ParsedGitHubRepo {
  branch: string;
}

export function createCodeAnalysisTools(
  options: CodeToolFactoryOptions,
): AgentTool[] {
  const policy = options.policy ?? DEFAULT_CODE_CONTEXT_POLICY;
  return [
    {
      name: "code_get_bound_repository",
      description:
        "Read the GitHub repository URL bound to the current Zotero item for paper-code analysis. Use before code repository analysis when no GitHub URL is in the current user message.",
      parameters: objectSchema({}),
      execute: async () => {
        const itemID = currentItemID(options);
        const binding = await loadCodeRepoBinding(itemID);
        if (!binding.ok) return resultFromError(binding);
        return jsonResult(
          {
            ok: true,
            itemID: binding.binding.itemID,
            githubUrl: binding.binding.githubUrl,
            owner: binding.binding.owner,
            repo: binding.binding.repo,
            branch: binding.binding.branch,
            message: "已读取当前论文绑定的 GitHub 仓库。",
          },
          "读取已绑定 GitHub 仓库",
        );
      },
    },
    {
      name: "code_bind_repository",
      description:
        "Bind a GitHub repository URL to the current Zotero item. Use when the user provides a GitHub repo for the current paper. This is a visible write to plugin-local storage.",
      parameters: objectSchema(
        {
          githubUrl: stringSchema("GitHub repository URL, e.g. https://github.com/owner/repo."),
          branch: stringSchema("Optional branch name. Overrides a /tree/<branch> URL branch."),
        },
        ["githubUrl"],
      ),
      execute: async (args) => {
        const itemID = currentItemID(options);
        if (itemID == null) return resultFromError(codeError("NO_CURRENT_ITEM", "当前没有选中的 Zotero 条目。"));
        const parsed = objectArgs(args);
        const githubUrl = stringArg(parsed, "githubUrl");
        const branch = stringArg(parsed, "branch");
        const repo = normalizeGitHubUrl(githubUrl, branch || undefined);
        if (!repo.ok) return resultFromError(repo);
        const saved = await saveCodeRepoBinding(itemID, {
          githubUrl: repo.normalizedUrl,
          owner: repo.owner,
          repo: repo.repo,
          ...(repo.branch ? { branch: repo.branch } : {}),
        });
        if (!saved.ok) return resultFromError(saved);
        return jsonResult(
          {
            ok: true,
            itemID,
            githubUrl: saved.binding.githubUrl,
            owner: saved.binding.owner,
            repo: saved.binding.repo,
            branch: saved.binding.branch,
            message: "已为当前论文绑定 GitHub 仓库。",
          },
          "已绑定 GitHub 仓库",
        );
      },
    },
    {
      name: "code_fetch_repo_tree",
      description:
        "Fetch and summarize the GitHub repository file tree for paper-code analysis. The harness filters noisy directories and returns bounded scored source-file candidates, not the full tree.",
      parameters: objectSchema({
        githubUrl: stringSchema("Optional GitHub repository URL. If omitted, use the current Zotero item's bound repository."),
        branch: stringSchema("Optional branch name. Overrides the bound or URL branch."),
      }),
      execute: async (args) => {
        const repo = await resolveRepository(options, objectArgs(args), false);
        if (!repo.ok) return resultFromError(repo);
        const tree = await fetchRepoTree(repo.repository, repo.branch, githubOptions(options, policy));
        if (!tree.ok) return resultFromError(tree);
        const candidates = filterRepoTreeFiles(tree.tree, policy);
        return jsonResult(
          {
            ok: true,
            githubUrl: repo.repository.normalizedUrl,
            owner: repo.repository.owner,
            repo: repo.repository.repo,
            branch: tree.branch,
            candidateFiles: candidates,
            totalCandidates: candidates.length,
            budget: {
              codeRepoTreeMaxEntries: policy.codeRepoTreeMaxEntries,
              codeMaxSelectedFiles: policy.codeMaxSelectedFiles,
            },
            message: "已获取并筛选仓库文件树。",
          },
          `获取 repo tree，候选 ${candidates.length} 个文件`,
        );
      },
    },
    {
      name: "code_select_relevant_files",
      description:
        "Select the most relevant source files for paper-code analysis using deterministic repository path scoring, analysis sections, optional keywords, and current Zotero metadata. Use before reading code files.",
      parameters: objectSchema({
        githubUrl: stringSchema("Optional GitHub repository URL. If omitted, use the current Zotero item's bound repository."),
        branch: stringSchema("Optional branch name."),
        analysisSections: arraySchema("Analysis sections requested by the user, e.g. 模型架构, 训练流程, 主要创新, 数据流/调用链."),
        extraKeywords: arraySchema("Optional extra keywords from the paper title, abstract, or user goal."),
      }),
      execute: async (args) => {
        const parsed = objectArgs(args);
        const repo = await resolveRepository(options, parsed, false);
        if (!repo.ok) return resultFromError(repo);
        const tree = await fetchRepoTree(repo.repository, repo.branch, githubOptions(options, policy));
        if (!tree.ok) return resultFromError(tree);
        const selected = await selectWithContextBoost(
          tree.tree,
          options,
          policy,
          stringArrayArg(parsed, "analysisSections"),
          stringArrayArg(parsed, "extraKeywords"),
        );
        if (!selected.length) {
          return resultFromError(
            codeError(
              "NO_RELEVANT_FILES",
              "没有在仓库中找到可分析的源码文件。请确认仓库分支正确，或提供更具体的源码路径。",
            ),
          );
        }
        return jsonResult(
          {
            ok: true,
            githubUrl: repo.repository.normalizedUrl,
            owner: repo.repository.owner,
            repo: repo.repository.repo,
            branch: tree.branch,
            selectedFiles: selected,
            budget: { codeMaxSelectedFiles: policy.codeMaxSelectedFiles },
          },
          `筛选关键源码 ${selected.length} 个文件`,
        );
      },
    },
    {
      name: "code_read_files_with_line_numbers",
      description:
        "Read selected GitHub source files from the top and inject stable line numbers. Use only after selecting specific paths. If a large file is truncated and needed symbols are missing, call code_search_in_files and code_read_file_ranges_with_line_numbers instead of guessing. The report must cite only file paths and line numbers returned by these tools.",
      parameters: objectSchema(
        {
          paths: arraySchema("Repository-relative source paths selected for analysis."),
          githubUrl: stringSchema("Optional GitHub repository URL. If omitted, use the current Zotero item's bound repository."),
          branch: stringSchema("Optional branch name."),
        },
        ["paths"],
      ),
      execute: async (args) => {
        const parsed = objectArgs(args);
        const paths = stringArrayArg(parsed, "paths");
        if (!paths.length) {
          return resultFromError(
            codeError(
              "FILE_READ_FAILED",
              "code_read_files_with_line_numbers 需要至少一个源码文件路径。",
            ),
          );
        }
        const repo = await resolveRepository(options, parsed, true);
        if (!repo.ok) return resultFromError(repo);
        const read = await readRequestedFiles(repo.repository, repo.branch, paths, options, policy);
        if (!read.files.length) {
          return resultFromError(
            codeError(
              "FILE_READ_FAILED",
              "没有成功读取任何源码文件。",
              read.failures.map((failure) => `${failure.path}: ${failure.error.message}`).join("; "),
            ),
          );
        }
        const formatted = formatFilesWithLineNumbers(read.files, policy);
        return jsonResult(
          {
            ok: true,
            githubUrl: repo.repository.normalizedUrl,
            owner: repo.repository.owner,
            repo: repo.repository.repo,
            branch: repo.branch,
            files: formatted.files,
            failedFiles: read.failures,
            totalChars: formatted.totalChars,
            budget: {
              codeMaxFileChars: policy.codeMaxFileChars,
              codeTotalCharBudget: policy.codeTotalCharBudget,
            },
          },
          `读取源码 ${formatted.files.length} 个文件 / ${formatted.totalChars} 字`,
        );
      },
    },
    {
      name: "code_search_in_files",
      description:
        "Search within selected GitHub source files for classes, functions, methods, or keywords and return real matching line numbers with short snippets. Use when an earlier file read was truncated or when you need to locate forward/__init__/loss/train/inference definitions inside a large file.",
      parameters: objectSchema(
        {
          paths: arraySchema("Repository-relative source paths to search."),
          queries: arraySchema("Search keywords, class names, or function names, e.g. forward, class Motus, __init__."),
          githubUrl: stringSchema("Optional GitHub repository URL. If omitted, use the current Zotero item's bound repository."),
          branch: stringSchema("Optional branch name."),
        },
        ["paths", "queries"],
      ),
      execute: async (args) => {
        const parsed = objectArgs(args);
        const paths = stringArrayArg(parsed, "paths");
        const queries = stringArrayArg(parsed, "queries");
        if (!paths.length || !queries.length) {
          return resultFromError(
            codeError(
              "FILE_READ_FAILED",
              "code_search_in_files 需要 paths 和 queries。",
            ),
          );
        }
        const repo = await resolveRepository(options, parsed, true);
        if (!repo.ok) return resultFromError(repo);
        const read = await readRequestedFiles(repo.repository, repo.branch, paths, options, policy);
        const matches = read.files.flatMap((file) =>
          searchSourceContent(
            file.path,
            file.content,
            queries,
            Math.max(1, policy.codeSearchMaxMatches - read.files.length),
          ),
        ).slice(0, policy.codeSearchMaxMatches);
        return jsonResult(
          {
            ok: true,
            githubUrl: repo.repository.normalizedUrl,
            owner: repo.repository.owner,
            repo: repo.repository.repo,
            branch: repo.branch,
            queries,
            matches,
            failedFiles: read.failures,
            message: matches.length
              ? "已在源码中找到匹配行号。可继续调用 code_read_file_ranges_with_line_numbers 读取相关行段。"
              : "未找到匹配行。请尝试更宽泛的关键词或先读取文件树。",
          },
          `搜索源码，命中 ${matches.length} 处`,
        );
      },
    },
    {
      name: "code_read_file_ranges_with_line_numbers",
      description:
        "Read exact line ranges from GitHub source files and inject stable line numbers. Use after code_search_in_files finds a symbol in a large file, or when you need later sections that code_read_files_with_line_numbers truncated.",
      parameters: objectSchema(
        {
          ranges: {
            type: "array",
            description: "Line ranges to read.",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                startLine: { type: "number" },
                endLine: { type: "number" },
              },
              required: ["path", "startLine", "endLine"],
              additionalProperties: false,
            },
          },
          githubUrl: stringSchema("Optional GitHub repository URL. If omitted, use the current Zotero item's bound repository."),
          branch: stringSchema("Optional branch name."),
        },
        ["ranges"],
      ),
      execute: async (args) => {
        const parsed = objectArgs(args);
        const ranges = rangeArgs(parsed);
        if (!ranges.length) {
          return resultFromError(
            codeError(
              "FILE_READ_FAILED",
              "code_read_file_ranges_with_line_numbers 需要至少一个有效 ranges 项。",
            ),
          );
        }
        const repo = await resolveRepository(options, parsed, true);
        if (!repo.ok) return resultFromError(repo);
        const uniquePaths = Array.from(new Set(ranges.map((range) => range.path)));
        const read = await readRequestedFiles(repo.repository, repo.branch, uniquePaths, options, policy);
        const byPath = new Map(read.files.map((file) => [file.path, file.content]));
        const files = [];
        let totalChars = 0;
        for (const range of ranges) {
          const content = byPath.get(range.path);
          if (!content) continue;
          const formatted = formatFileRangeWithLineNumbers(
            range.path,
            content,
            range.startLine,
            range.endLine,
            policy,
          );
          if (totalChars + formatted.chars > policy.codeTotalCharBudget) break;
          totalChars += formatted.chars;
          files.push(formatted);
        }
        if (!files.length) {
          return resultFromError(
            codeError(
              "FILE_READ_FAILED",
              "没有成功读取任何源码行段。",
              read.failures.map((failure) => `${failure.path}: ${failure.error.message}`).join("; "),
            ),
          );
        }
        return jsonResult(
          {
            ok: true,
            githubUrl: repo.repository.normalizedUrl,
            owner: repo.repository.owner,
            repo: repo.repository.repo,
            branch: repo.branch,
            files,
            failedFiles: read.failures,
            totalChars,
            budget: {
              codeRangeMaxLines: policy.codeRangeMaxLines,
              codeTotalCharBudget: policy.codeTotalCharBudget,
            },
          },
          `读取源码行段 ${files.length} 段 / ${totalChars} 字`,
        );
      },
    },
    {
      name: "code_get_repository_readme",
      description:
        "Read the repository README excerpt to understand the project entry points and author-provided usage notes. Use as lightweight context before deeper source reads.",
      parameters: objectSchema({
        githubUrl: stringSchema("Optional GitHub repository URL. If omitted, use the current Zotero item's bound repository."),
        branch: stringSchema("Optional branch name."),
      }),
      execute: async (args) => {
        const repo = await resolveRepository(options, objectArgs(args), true);
        if (!repo.ok) return resultFromError(repo);
        const readme = await readRepositoryReadme(
          repo.repository,
          repo.branch,
          githubOptions(options, policy),
        );
        if (!readme.ok) return resultFromError(readme);
        return jsonResult(
          {
            ok: true,
            githubUrl: repo.repository.normalizedUrl,
            owner: repo.repository.owner,
            repo: repo.repository.repo,
            branch: repo.branch,
            path: readme.path,
            truncated: readme.truncated,
            markdown: readme.markdown,
          },
          `读取 README: ${readme.path}`,
        );
      },
    },
    {
      name: "code_save_analysis",
      description:
        "Save the current paper-code analysis Markdown for the current Zotero item in plugin-local storage. Use only after the user explicitly asks to save the generated report.",
      requiresApproval: true,
      parameters: objectSchema(
        {
          githubUrl: stringSchema("GitHub repository URL used for the analysis. If omitted, use the bound repository."),
          analysisMarkdown: stringSchema("Complete Markdown analysis report to persist."),
          sections: arraySchema("Analysis sections included in the report."),
        },
        ["analysisMarkdown"],
      ),
      execute: async (args) => {
        const itemID = currentItemID(options);
        if (itemID == null) return resultFromError(codeError("NO_CURRENT_ITEM", "当前没有选中的 Zotero 条目。"));
        const parsed = objectArgs(args);
        const markdown = stringArg(parsed, "analysisMarkdown");
        if (!markdown) {
          return resultFromError(
            codeError("STORAGE_FAILED", "保存代码分析需要非空 Markdown 内容。"),
          );
        }
        const repo = await resolveRepository(options, parsed, false);
        if (!repo.ok) return resultFromError(repo);
        const saved = await saveCodeAnalysis(itemID, {
          githubUrl: repo.repository.normalizedUrl,
          owner: repo.repository.owner,
          repo: repo.repository.repo,
          branch: repo.branch,
          sections: stringArrayArg(parsed, "sections"),
          markdown,
        });
        if (!saved.ok) return resultFromError(saved);
        return jsonResult(
          {
            ok: true,
            itemID,
            githubUrl: saved.analysis.githubUrl,
            owner: saved.analysis.owner,
            repo: saved.analysis.repo,
            branch: saved.analysis.branch,
            sections: saved.analysis.sections,
            markdownChars: saved.analysis.markdown.length,
            createdAt: saved.analysis.createdAt,
            updatedAt: saved.analysis.updatedAt,
            message: "已保存当前论文的代码分析报告。",
          },
          `保存代码分析 ${saved.analysis.markdown.length} 字`,
        );
      },
    },
    {
      name: "code_get_saved_analysis",
      description:
        "Read the saved paper-code analysis Markdown for the current Zotero item. Use when the user wants to view or continue from a previously saved code analysis.",
      parameters: objectSchema({}),
      execute: async () => {
        const loaded = await loadCodeAnalysis(currentItemID(options));
        if (!loaded.ok) return resultFromError(loaded);
        return jsonResult(
          {
            ok: true,
            itemID: loaded.analysis.itemID,
            githubUrl: loaded.analysis.githubUrl,
            owner: loaded.analysis.owner,
            repo: loaded.analysis.repo,
            branch: loaded.analysis.branch,
            sections: loaded.analysis.sections,
            markdown: loaded.analysis.markdown,
            createdAt: loaded.analysis.createdAt,
            updatedAt: loaded.analysis.updatedAt,
          },
          `读取已保存代码分析 ${loaded.analysis.markdown.length} 字`,
        );
      },
    },
  ];
}

async function resolveRepository(
  options: CodeToolFactoryOptions,
  args: Record<string, unknown>,
  requireBranch: boolean,
): Promise<CodeResult<{ repository: ResolvedRepository; branch: string }>> {
  const explicitBranch = stringArg(args, "branch");
  const githubUrl = stringArg(args, "githubUrl");
  let parsed: CodeResult<ParsedGitHubRepo>;
  if (githubUrl) {
    parsed = normalizeGitHubUrl(githubUrl, explicitBranch || undefined);
  } else {
    const binding = await loadCodeRepoBinding(currentItemID(options));
    if (!binding.ok) return binding;
    parsed = {
      ok: true,
      owner: binding.binding.owner,
      repo: binding.binding.repo,
      branch: explicitBranch || binding.binding.branch,
      normalizedUrl: binding.binding.githubUrl,
    };
  }
  if (!parsed.ok) return parsed;
  let branch = explicitBranch || parsed.branch || "";
  if (!branch && requireBranch) {
    const defaultBranch = await fetchDefaultBranch(parsed, githubOptions(options, options.policy ?? DEFAULT_CODE_CONTEXT_POLICY));
    if (!defaultBranch.ok) return defaultBranch;
    branch = defaultBranch.branch;
  }
  return {
    ok: true,
    repository: {
      ...parsed,
      branch,
    },
    branch,
  };
}

async function selectWithContextBoost(
  tree: Array<{ path: string; type: "blob"; size?: number }>,
  options: CodeToolFactoryOptions,
  policy: CodeContextPolicy,
  analysisSections: string[],
  extraKeywords: string[],
): Promise<ScoredRepoFile[]> {
  const selected = selectRelevantFiles(tree, {
    ...policy,
    codeMaxSelectedFiles: Math.max(policy.codeMaxSelectedFiles * 3, policy.codeMaxSelectedFiles),
  });
  const metadata = await readCurrentMetadataKeywords(options);
  const keywords = [...analysisSections, ...extraKeywords, ...metadata]
    .flatMap(splitKeywords)
    .filter((keyword) => keyword.length >= 2);
  if (!keywords.length) return selected.slice(0, policy.codeMaxSelectedFiles);
  return selected
    .map((file) => {
      const lower = file.path.toLowerCase();
      const matched = keywords.filter((keyword) => lower.includes(keyword.toLowerCase()));
      return matched.length
        ? {
            ...file,
            score: file.score + Math.min(matched.length, 5) * 5,
            reason: `${file.reason} + paper/user keywords: ${matched.slice(0, 5).join(", ")}`,
          }
        : file;
    })
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, policy.codeMaxSelectedFiles);
}

async function readCurrentMetadataKeywords(
  options: CodeToolFactoryOptions,
): Promise<string[]> {
  const itemID = currentItemID(options);
  if (itemID == null || !options.source) return [];
  try {
    const metadata = await options.source.getItem(itemID);
    return [
      metadata?.title ?? "",
      metadata?.abstract ?? "",
      ...(metadata?.tags ?? []),
    ];
  } catch {
    return [];
  }
}

async function readRequestedFiles(
  repo: ParsedGitHubRepo,
  branch: string,
  paths: string[],
  options: CodeToolFactoryOptions,
  policy: CodeContextPolicy,
): Promise<{
  files: Array<{ path: string; content: string }>;
  failures: Array<{ path: string; error: { code: string; message: string; detail?: string } }>;
}> {
  const files: Array<{ path: string; content: string }> = [];
  const failures: Array<{ path: string; error: { code: string; message: string; detail?: string } }> = [];
  for (const path of paths) {
    if (!isAllowedSourcePath(path, policy)) {
      failures.push({
        path,
        error: {
          code: "BINARY_FILE_SKIPPED",
          message: "该路径扩展名不在允许列表中，或位于跳过目录内。",
        },
      });
      continue;
    }
    const result = await readGitHubFile(repo, path, branch, githubOptions(options, policy));
    if (!result.ok) {
      failures.push({ path, error: result.error });
      continue;
    }
    if (isLikelyBinaryContent(result.content)) {
      failures.push({
        path,
        error: {
          code: "BINARY_FILE_SKIPPED",
          message: "文件内容疑似二进制，已跳过。",
        },
      });
      continue;
    }
    files.push({ path, content: result.content });
  }
  return { files, failures };
}

function githubOptions(
  options: CodeToolFactoryOptions,
  policy: CodeContextPolicy,
) {
  return {
    policy,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.githubToken ? { token: options.githubToken } : {}),
  };
}

function jsonResult(value: unknown, summary: string): ToolExecutionResult {
  return {
    output: JSON.stringify(value, null, 2),
    summary,
    context: { planMode: "code_repository", sourceKind: "github" },
  };
}

function resultFromError(result: { ok: false; error: unknown }): ToolExecutionResult {
  const error = result.error;
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message)
      : "代码仓库工具执行失败。";
  return {
    output: JSON.stringify({ ok: false, error }, null, 2),
    summary: message,
    context: { planMode: "code_repository", sourceKind: "github" },
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

function stringArrayArg(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean)
    : [];
}

function rangeArgs(
  args: Record<string, unknown>,
): Array<{ path: string; startLine: number; endLine: number }> {
  const value = args.ranges;
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const path = typeof record.path === "string" ? record.path.trim() : "";
    const startLine =
      typeof record.startLine === "number" && Number.isFinite(record.startLine)
        ? Math.floor(record.startLine)
        : null;
    const endLine =
      typeof record.endLine === "number" && Number.isFinite(record.endLine)
        ? Math.floor(record.endLine)
        : null;
    if (!path || startLine == null || endLine == null || startLine < 1 || endLine < startLine) {
      return [];
    }
    return [{ path, startLine, endLine }];
  });
}

function splitKeywords(value: string): string[] {
  return value
    .split(/[\s,;:，。；：/\\|()[\]{}"'`<>]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function currentItemID(options: CodeToolFactoryOptions): number | null {
  return typeof options.itemID === "number" ? options.itemID : null;
}
