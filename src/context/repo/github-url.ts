import { repoError, type NormalizedGitHubRepo, type RepoResult } from "./types";

const OWNER_REPO_RE = /^[A-Za-z0-9_.-]+$/;

export function normalizeGitHubRepoUrl(
  input: string,
  explicitRef?: string,
): RepoResult<NormalizedGitHubRepo> {
  const parsed = parseGitHubRepoUrl(input);
  if (!parsed.ok) return parsed;
  const ref = explicitRef?.trim() || parsed.ref;
  return {
    ...parsed,
    ...(ref ? { ref } : {}),
    normalizedUrl: `https://github.com/${parsed.owner}/${parsed.repo}`,
  };
}

export function parseGitHubRepoUrl(
  input: string,
): RepoResult<NormalizedGitHubRepo> {
  const originalUrl = input.trim();
  if (!originalUrl) {
    return invalid("GitHub 仓库 URL 不能为空。");
  }
  const ssh = originalUrl.match(
    /^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/,
  );
  if (ssh) {
    return valid(originalUrl, ssh[1], stripGitSuffix(ssh[2]));
  }

  let url: URL;
  try {
    url = new URL(originalUrl);
  } catch {
    return invalid("无法解析 GitHub URL，请粘贴完整仓库链接。");
  }
  if (url.hostname.toLowerCase() !== "github.com") {
    return invalid("只支持 github.com 的公开仓库链接。");
  }
  const segments = url.pathname
    .split("/")
    .map((segment) => decodeURIComponent(segment))
    .filter(Boolean);
  if (segments.length < 2) {
    return invalid("GitHub URL 必须包含 owner/repo。");
  }
  const owner = segments[0];
  const repo = stripGitSuffix(segments[1]);
  if (!isSafeName(owner) || !isSafeName(repo)) {
    return invalid("GitHub owner/repo 包含非法字符。");
  }
  const kind = segments[2];
  const rest = segments.slice(3);
  if (kind === "tree") {
    const ref = rest.join("/");
    return valid(originalUrl, owner, repo, ref || undefined);
  }
  if (kind === "blob") {
    const { ref, sourcePath } = splitBlobRefAndPath(rest);
    return valid(originalUrl, owner, repo, ref || undefined, sourcePath);
  }
  return valid(originalUrl, owner, repo);
}

function valid(
  originalUrl: string,
  owner: string,
  repo: string,
  ref?: string,
  sourcePath?: string,
): RepoResult<NormalizedGitHubRepo> {
  if (!owner || !repo || !isSafeName(owner) || !isSafeName(repo)) {
    return invalid("GitHub URL 必须包含合法的 owner/repo。");
  }
  return {
    ok: true,
    provider: "github",
    owner,
    repo,
    ...(ref ? { ref } : {}),
    originalUrl,
    normalizedUrl: `https://github.com/${owner}/${repo}`,
    ...(sourcePath ? { sourcePath } : {}),
  };
}

function splitBlobRefAndPath(segments: string[]): {
  ref?: string;
  sourcePath?: string;
} {
  if (!segments.length) return {};
  for (let split = 1; split < segments.length; split++) {
    const path = segments.slice(split).join("/");
    if (startsWithLikelySourceRoot(path)) {
      return {
        ref: segments.slice(0, split).join("/"),
        sourcePath: path,
      };
    }
  }
  for (let split = 1; split < segments.length; split++) {
    const path = segments.slice(split).join("/");
    if (looksLikeSourcePath(path)) {
      return {
        ref: segments.slice(0, split).join("/"),
        sourcePath: path,
      };
    }
  }
  return {
    ref: segments[0],
    sourcePath: segments.slice(1).join("/") || undefined,
  };
}

function startsWithLikelySourceRoot(path: string): boolean {
  const first = path.split("/")[0]?.toLowerCase() ?? "";
  return [
    "src",
    "lib",
    "app",
    "models",
    "model",
    "train",
    "training",
    "data",
    "datasets",
    "configs",
    "config",
    "scripts",
    "tests",
  ].includes(first);
}

function looksLikeSourcePath(path: string): boolean {
  const basename = path.split("/").pop()?.toLowerCase() ?? "";
  if (!basename) return false;
  if (basename.includes(".")) return true;
  return ["dockerfile", "makefile", "readme", "license", "requirements"].some(
    (name) => basename === name || basename.startsWith(`${name}.`),
  );
}

function stripGitSuffix(repo: string): string {
  return repo.replace(/\.git$/i, "");
}

function isSafeName(value: string): boolean {
  return OWNER_REPO_RE.test(value) && !value.includes("..");
}

function invalid(message: string) {
  return repoError(
    "INVALID_GITHUB_URL",
    message,
    true,
    "请使用 https://github.com/owner/repo 或 git@github.com:owner/repo.git 格式。",
  );
}
