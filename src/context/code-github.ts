import {
  DEFAULT_CODE_CONTEXT_POLICY,
  type CodeContextPolicy,
} from "./code-policy";

export type CodeErrorCode =
  | "INVALID_GITHUB_URL"
  | "NO_CURRENT_ITEM"
  | "NO_BOUND_REPOSITORY"
  | "GITHUB_RATE_LIMITED"
  | "GITHUB_NOT_FOUND"
  | "GITHUB_PRIVATE_OR_FORBIDDEN"
  | "GITHUB_BRANCH_NOT_FOUND"
  | "GITHUB_TREE_TRUNCATED"
  | "NO_RELEVANT_FILES"
  | "FILE_READ_FAILED"
  | "FILE_TOO_LARGE"
  | "BINARY_FILE_SKIPPED"
  | "STORAGE_FAILED"
  | "NO_SAVED_CODE_ANALYSIS"
  | "UNKNOWN_ERROR";

export interface CodeToolError {
  code: CodeErrorCode;
  message: string;
  detail?: string;
}

export type CodeResult<T> = ({ ok: true } & T) | { ok: false; error: CodeToolError };

export interface ParsedGitHubRepo {
  owner: string;
  repo: string;
  branch?: string;
  normalizedUrl: string;
}

export interface GitHubTreeEntry {
  path: string;
  type: "blob" | "tree" | string;
  size?: number;
  sha?: string;
  url?: string;
}

export interface GitHubTreeFile {
  path: string;
  type: "blob";
  size?: number;
}

export interface GitHubRequestOptions {
  fetchImpl?: typeof fetch;
  token?: string;
  policy?: CodeContextPolicy;
}

interface RepoResponse {
  default_branch?: string;
}

interface TreeResponse {
  tree?: GitHubTreeEntry[];
  truncated?: boolean;
}

interface ContentsResponse {
  type?: string;
  encoding?: string;
  content?: string;
  size?: number;
  message?: string;
}

const GITHUB_API = "https://api.github.com";

export function parseGitHubUrl(input: string): CodeResult<ParsedGitHubRepo> {
  return normalizeGitHubUrl(input);
}

export function normalizeGitHubUrl(
  input: string,
  explicitBranch?: string,
): CodeResult<ParsedGitHubRepo> {
  const raw = input.trim();
  if (!raw) {
    return codeError(
      "INVALID_GITHUB_URL",
      "请输入 GitHub 仓库 URL，例如 https://github.com/owner/repo。",
    );
  }

  const ssh = /^git@github\.com:([^/:\s]+)\/([^/:\s]+?)(?:\.git)?$/i.exec(raw);
  if (ssh) {
    const owner = ssh[1];
    const repo = stripGitSuffix(ssh[2]);
    return normalizedRepo(owner, repo, explicitBranch);
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return codeError(
      "INVALID_GITHUB_URL",
      "GitHub URL 格式无效，请使用 https://github.com/owner/repo。",
      raw,
    );
  }

  if (url.hostname.toLowerCase() !== "github.com") {
    return codeError(
      "INVALID_GITHUB_URL",
      "当前只支持 github.com 仓库 URL。",
      url.hostname,
    );
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    return codeError(
      "INVALID_GITHUB_URL",
      "GitHub URL 必须包含 owner/repo。",
      url.pathname,
    );
  }

  const owner = decodeURIComponent(parts[0]);
  const repo = stripGitSuffix(decodeURIComponent(parts[1]));
  const branchFromUrl =
    parts[2] === "tree" && parts.length > 3
      ? decodeURIComponent(parts.slice(3).join("/"))
      : undefined;
  return normalizedRepo(owner, repo, explicitBranch?.trim() || branchFromUrl);
}

export async function fetchDefaultBranch(
  repo: ParsedGitHubRepo,
  options: GitHubRequestOptions = {},
): Promise<CodeResult<{ branch: string }>> {
  const result = await githubJson<RepoResponse>(
    `${GITHUB_API}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`,
    options,
  );
  if (!result.ok) return result;
  const branch = result.value.default_branch;
  if (!branch) {
    return codeError(
      "GITHUB_BRANCH_NOT_FOUND",
      "无法读取 GitHub 仓库默认分支。",
      repo.normalizedUrl,
    );
  }
  return { ok: true, branch };
}

export async function fetchRepoTree(
  repo: ParsedGitHubRepo,
  branch: string | undefined,
  options: GitHubRequestOptions = {},
): Promise<
  CodeResult<{
    githubUrl: string;
    branch: string;
    defaultBranch?: string;
    tree: GitHubTreeFile[];
  }>
> {
  const policy = options.policy ?? DEFAULT_CODE_CONTEXT_POLICY;
  let resolvedBranch = branch || repo.branch;
  let defaultBranch: string | undefined;
  if (!resolvedBranch) {
    const defaultResult = await fetchDefaultBranch(repo, options);
    if (!defaultResult.ok) return defaultResult;
    resolvedBranch = defaultResult.branch;
    defaultBranch = defaultResult.branch;
  }

  const result = await githubJson<TreeResponse>(
    `${GITHUB_API}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/git/trees/${encodeURIComponent(resolvedBranch)}?recursive=1`,
    options,
  );
  if (!result.ok) return result;
  if (result.value.truncated) {
    return codeError(
      "GITHUB_TREE_TRUNCATED",
      "GitHub 返回的仓库文件树被截断，当前仓库过大。请换一个更小的分支或后续支持更窄范围读取。",
      `${repo.normalizedUrl}#${resolvedBranch}`,
    );
  }
  const tree = (result.value.tree ?? [])
    .filter((entry): entry is GitHubTreeFile => entry.type === "blob" && !!entry.path)
    .slice(0, policy.codeRepoTreeMaxEntries)
    .map((entry) => ({
      path: entry.path,
      type: "blob" as const,
      ...(typeof entry.size === "number" ? { size: entry.size } : {}),
    }));
  return {
    ok: true,
    githubUrl: repo.normalizedUrl,
    branch: resolvedBranch,
    ...(defaultBranch ? { defaultBranch } : {}),
    tree,
  };
}

export async function readGitHubFile(
  repo: ParsedGitHubRepo,
  path: string,
  branch: string,
  options: GitHubRequestOptions = {},
): Promise<CodeResult<{ path: string; content: string; size?: number }>> {
  const result = await githubJson<ContentsResponse>(
    `${GITHUB_API}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
    options,
  );
  if (!result.ok) return result;
  const value = result.value;
  if (value.type !== "file" || !value.content) {
    return codeError("FILE_READ_FAILED", `无法读取文件：${path}`, "GitHub contents API did not return a file.");
  }
  if (value.encoding !== "base64") {
    return codeError("FILE_READ_FAILED", `无法读取文件：${path}`, `Unsupported encoding: ${value.encoding ?? "unknown"}`);
  }
  try {
    return {
      ok: true,
      path,
      content: decodeBase64(value.content),
      ...(typeof value.size === "number" ? { size: value.size } : {}),
    };
  } catch (err) {
    return codeError(
      "FILE_READ_FAILED",
      `文件解码失败：${path}`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

export async function readRepositoryReadme(
  repo: ParsedGitHubRepo,
  branch: string,
  options: GitHubRequestOptions = {},
): Promise<
  CodeResult<{
    path: string;
    markdown: string;
    truncated: boolean;
  }>
> {
  const policy = options.policy ?? DEFAULT_CODE_CONTEXT_POLICY;
  for (const path of ["README.md", "README.rst", "README.txt", "readme.md"]) {
    const result = await readGitHubFile(repo, path, branch, options);
    if (!result.ok) {
      if (
        result.error.code === "GITHUB_NOT_FOUND" ||
        result.error.code === "FILE_READ_FAILED"
      ) {
        continue;
      }
      return result;
    }
    const markdown = result.content.slice(0, policy.codeReadmeMaxChars);
    return {
      ok: true,
      path,
      markdown,
      truncated: result.content.length > markdown.length,
    };
  }
  return codeError(
    "GITHUB_NOT_FOUND",
    "未找到仓库 README（已尝试 README.md / README.rst / README.txt / readme.md）。",
  );
}

export function codeError(
  code: CodeErrorCode,
  message: string,
  detail?: string,
): { ok: false; error: CodeToolError } {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(detail ? { detail } : {}),
    },
  };
}

async function githubJson<T>(
  url: string,
  options: GitHubRequestOptions,
): Promise<CodeResult<{ value: T }>> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const policy = options.policy ?? DEFAULT_CODE_CONTEXT_POLICY;
  if (typeof fetchImpl !== "function") {
    return codeError("UNKNOWN_ERROR", "当前环境不支持 fetch，无法访问 GitHub API。");
  }

  let lastError: CodeResult<{ value: T }> | null = null;
  const attempts = Math.max(1, policy.githubRequestRetries + 1);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        fetchImpl,
        url,
        {
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          },
        },
        policy.githubRequestTimeoutMs,
      );
    } catch (err) {
      lastError = codeError(
        "UNKNOWN_ERROR",
        isTimeoutError(err)
          ? `访问 GitHub API 超时（${Math.round(policy.githubRequestTimeoutMs / 1000)} 秒）。如果你挂了代理，请确认 Zotero 进程也能走代理。`
          : "访问 GitHub API 时发生网络错误。",
        err instanceof Error ? err.message : String(err),
      );
      if (attempt < attempts) {
        await delay(350 * attempt);
        continue;
      }
      return lastError;
    }

    const body = await response.text();
    if (!response.ok) {
      const mapped = githubHttpError(response, body);
      lastError = mapped;
      if (attempt < attempts && shouldRetryStatus(response.status, mapped.error.code)) {
        await delay(500 * attempt);
        continue;
      }
      return mapped;
    }
    try {
      return { ok: true, value: JSON.parse(body) as T };
    } catch (err) {
      return codeError(
        "UNKNOWN_ERROR",
        "GitHub API 返回了无法解析的 JSON。",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return lastError ?? codeError("UNKNOWN_ERROR", "GitHub API 请求失败。");
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const Controller = globalThis.AbortController;
  if (!Controller || timeoutMs <= 0) {
    return fetchImpl(url, init);
  }
  const controller = new Controller();
  const timeout = globalThis.setTimeout?.(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    if (timeout != null) globalThis.clearTimeout?.(timeout);
  }
}

function shouldRetryStatus(status: number, code: CodeErrorCode): boolean {
  return (
    status === 408 ||
    status === 409 ||
    status === 429 ||
    status >= 500 ||
    code === "GITHUB_RATE_LIMITED"
  );
}

function isTimeoutError(err: unknown): boolean {
  const message = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /abort|timeout/i.test(message);
}

function delay(ms: number): Promise<void> {
  return typeof globalThis.setTimeout === "function"
    ? new Promise((resolve) => globalThis.setTimeout(resolve, ms))
    : Promise.resolve();
}

function githubHttpError(
  response: Response,
  body: string,
): { ok: false; error: CodeToolError } {
  const detail = body.slice(0, 500);
  const remaining = response.headers.get("x-ratelimit-remaining");
  if (response.status === 403 && remaining === "0") {
    return codeError(
      "GITHUB_RATE_LIMITED",
      "GitHub API 速率限制已用完。稍后重试，或后续在设置中配置 GitHub Token。",
      detail,
    );
  }
  if (response.status === 404) {
    return codeError(
      "GITHUB_NOT_FOUND",
      "GitHub 仓库、分支或文件不存在，或当前无权限访问。",
      detail,
    );
  }
  if (response.status === 401 || response.status === 403) {
    return codeError(
      "GITHUB_PRIVATE_OR_FORBIDDEN",
      "GitHub 仓库可能是私有仓库，或当前 API 请求无权限访问。",
      detail,
    );
  }
  if (response.status === 422) {
    return codeError(
      "GITHUB_BRANCH_NOT_FOUND",
      "GitHub 分支不存在或无法读取该分支的文件树。",
      detail,
    );
  }
  return codeError(
    "UNKNOWN_ERROR",
    `GitHub API 请求失败：HTTP ${response.status}`,
    detail,
  );
}

function normalizedRepo(
  owner: string,
  repo: string,
  branch?: string,
): CodeResult<ParsedGitHubRepo> {
  const cleanOwner = owner.trim();
  const cleanRepo = repo.trim();
  if (!cleanOwner || !cleanRepo) {
    return codeError(
      "INVALID_GITHUB_URL",
      "GitHub URL 必须包含非空 owner/repo。",
    );
  }
  if (cleanOwner.includes("/") || cleanRepo.includes("/")) {
    return codeError(
      "INVALID_GITHUB_URL",
      "GitHub owner/repo 解析失败，请检查 URL。",
      `${owner}/${repo}`,
    );
  }
  return {
    ok: true,
    owner: cleanOwner,
    repo: cleanRepo,
    ...(branch ? { branch } : {}),
    normalizedUrl: `https://github.com/${cleanOwner}/${cleanRepo}`,
  };
}

function stripGitSuffix(repo: string): string {
  return repo.endsWith(".git") ? repo.slice(0, -4) : repo;
}

function encodePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

function decodeBase64(value: string): string {
  const normalized = value.replace(/\s/g, "");
  const maybeBuffer = (globalThis as unknown as { Buffer?: typeof Buffer }).Buffer;
  if (maybeBuffer) return maybeBuffer.from(normalized, "base64").toString("utf-8");
  const binary = globalThis.atob(normalized);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
