import type { RepoContextPolicy } from "./repo-policy";
import {
  repoError,
  type NormalizedGitHubRepo,
  type RepoResult,
  type ResolvedRepoRef,
} from "./types";

export interface GitHubClientOptions {
  fetchImpl?: typeof fetch;
  token?: string;
  policy: RepoContextPolicy;
}

interface GitHubRepoResponse {
  default_branch?: string;
  html_url?: string;
}

interface GitHubCommitResponse {
  sha?: string;
}

interface GitHubRefNameResponse {
  name?: string;
  commit?: { sha?: string };
}

export async function resolveGitHubRef(
  repo: NormalizedGitHubRepo,
  maybeRef: string | undefined,
  options: GitHubClientOptions,
): Promise<RepoResult<{ resolved: ResolvedRepoRef }>> {
  const metadata = await githubJson<GitHubRepoResponse>(
    `https://api.github.com/repos/${repo.owner}/${repo.repo}`,
    options,
  );
  if (!metadata.ok) return metadata;
  const defaultBranch = metadata.value.default_branch || "main";
  const ref = maybeRef?.trim() || repo.ref || defaultBranch;
  const direct = await resolveCommit(repo.owner, repo.repo, ref, options);
  if (direct.ok) {
    return {
      ok: true,
      resolved: {
        owner: repo.owner,
        repo: repo.repo,
        ref,
        defaultBranch,
        commitSha: direct.sha,
        archiveUrl: archiveUrl(repo.owner, repo.repo, ref),
        webUrl: `https://github.com/${repo.owner}/${repo.repo}/tree/${encodeURIComponent(ref)}`,
      },
    };
  }
  if (ref.includes("/")) {
    const matched = await resolveLongestKnownRef(
      repo.owner,
      repo.repo,
      ref,
      options,
    );
    if (matched.ok) {
      return {
        ok: true,
        resolved: {
          owner: repo.owner,
          repo: repo.repo,
          ref: matched.ref,
          defaultBranch,
          commitSha: matched.sha,
          archiveUrl: archiveUrl(repo.owner, repo.repo, matched.ref),
          webUrl: `https://github.com/${repo.owner}/${repo.repo}/tree/${encodeURIComponent(matched.ref)}`,
        },
      };
    }
  }
  return repoError(
    "REF_NOT_FOUND",
    `没有找到仓库 ${repo.owner}/${repo.repo} 的 ref：${ref}`,
    true,
    "请确认分支、tag 或 commit sha 是否正确；也可以留空使用默认分支。",
    direct,
  );
}

export async function downloadGitHubArchive(
  resolved: ResolvedRepoRef,
  options: GitHubClientOptions,
): Promise<RepoResult<{ bytes: Uint8Array; contentType: string }>> {
  const response = await githubFetch(resolved.archiveUrl, options);
  if (!response.ok) return response;
  const contentLength = Number(
    response.response.headers.get("content-length") || "0",
  );
  if (contentLength > options.policy.maxArchiveBytes) {
    return repoError(
      "ARCHIVE_TOO_LARGE",
      `GitHub archive 过大（${contentLength} bytes），超过当前安全限制。`,
      true,
      "可以指定更小的子仓库/分支，或后续提高 maxArchiveBytes 策略。",
    );
  }
  try {
    const buffer = await response.response.arrayBuffer();
    if (buffer.byteLength > options.policy.maxArchiveBytes) {
      return repoError(
        "ARCHIVE_TOO_LARGE",
        `GitHub archive 实际下载大小过大（${buffer.byteLength} bytes）。`,
        true,
      );
    }
    return {
      ok: true,
      bytes: new Uint8Array(buffer),
      contentType: response.response.headers.get("content-type") || "",
    };
  } catch (err) {
    return repoError(
      "ARCHIVE_DOWNLOAD_FAILED",
      "下载 GitHub archive 时读取响应失败。",
      true,
      "网络代理不稳定时请稍后重试，或在设置中配置 GitHub Token。",
      errorDetail(err),
    );
  }
}

async function resolveCommit(
  owner: string,
  repo: string,
  ref: string,
  options: GitHubClientOptions,
): Promise<RepoResult<{ sha?: string }>> {
  const result = await githubJson<GitHubCommitResponse>(
    `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`,
    options,
  );
  if (!result.ok) return result;
  return { ok: true, sha: result.value.sha };
}

async function resolveLongestKnownRef(
  owner: string,
  repo: string,
  rawRef: string,
  options: GitHubClientOptions,
): Promise<RepoResult<{ ref: string; sha?: string }>> {
  const names = await Promise.all([
    githubJson<GitHubRefNameResponse[]>(
      `https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`,
      options,
    ),
    githubJson<GitHubRefNameResponse[]>(
      `https://api.github.com/repos/${owner}/${repo}/tags?per_page=100`,
      options,
    ),
  ]);
  const candidates = names
    .flatMap((result) => (result.ok ? result.value : []))
    .map((entry) => ({
      ref: entry.name || "",
      sha: entry.commit?.sha,
    }))
    .filter((entry) => entry.ref && rawRef.startsWith(entry.ref))
    .sort((a, b) => b.ref.length - a.ref.length);
  const match = candidates[0];
  if (!match) {
    return repoError(
      "REF_NOT_FOUND",
      `没有找到匹配的 branch/tag：${rawRef}`,
      true,
    );
  }
  return { ok: true, ref: match.ref, sha: match.sha };
}

async function githubJson<T>(
  url: string,
  options: GitHubClientOptions,
): Promise<RepoResult<{ value: T }>> {
  const fetched = await githubFetch(url, options);
  if (!fetched.ok) return fetched;
  try {
    return { ok: true, value: (await fetched.response.json()) as T };
  } catch (err) {
    return repoError(
      "ARCHIVE_DOWNLOAD_FAILED",
      "GitHub API 响应不是有效 JSON。",
      true,
      undefined,
      errorDetail(err),
    );
  }
}

async function githubFetch(
  url: string,
  options: GitHubClientOptions,
): Promise<RepoResult<{ response: Response }>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let lastError: unknown;
  for (
    let attempt = 0;
    attempt <= options.policy.githubRequestRetries;
    attempt++
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.policy.githubRequestTimeoutMs,
    );
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: requestHeaders(options.token),
      });
      if (response.ok) return { ok: true, response };
      return httpError(response);
    } catch (err) {
      lastError = err;
      if (attempt >= options.policy.githubRequestRetries) break;
      await delay(400 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  return repoError(
    "ARCHIVE_DOWNLOAD_FAILED",
    "连接 GitHub 失败或请求超时。",
    true,
    "请检查代理/梯子是否允许 Zotero 访问 github.com 和 api.github.com；也可以稍后重试。",
    errorDetail(lastError),
  );
}

function httpError(response: Response) {
  const remaining = response.headers.get("x-ratelimit-remaining");
  if (response.status === 403 && remaining === "0") {
    return repoError(
      "RATE_LIMITED",
      "GitHub API 速率限制已用完。",
      true,
      "在插件设置里配置 GitHub Token 可以显著提高速率限制；或等待限制窗口重置后重试。",
      { status: response.status },
    );
  }
  if (response.status === 404) {
    return repoError(
      "REPO_NOT_FOUND",
      "GitHub 仓库、ref 或 archive 未找到。",
      true,
      "请确认仓库是公开仓库，URL/ref 拼写正确。",
      { status: response.status },
    );
  }
  if (response.status === 401 || response.status === 403) {
    return repoError(
      "RATE_LIMITED",
      "GitHub 拒绝访问该仓库或当前请求。",
      true,
      "公开仓库通常无需登录；如果你频繁请求，请在设置中配置 GitHub Token。",
      { status: response.status },
    );
  }
  return repoError(
    "ARCHIVE_DOWNLOAD_FAILED",
    `GitHub 请求失败：HTTP ${response.status}`,
    true,
    undefined,
    { status: response.status },
  );
}

function archiveUrl(owner: string, repo: string, ref: string): string {
  return `https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(ref)}`;
}

function requestHeaders(token?: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json, application/zip, */*",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
