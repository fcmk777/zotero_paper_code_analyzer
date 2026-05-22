import { describe, expect, it } from "vitest";
import { normalizeGitHubRepoUrl } from "../../../src/context/repo/github-url";

describe("normalizeGitHubRepoUrl", () => {
  it.each([
    ["https://github.com/owner/repo", undefined, undefined],
    ["https://github.com/owner/repo.git", undefined, undefined],
    ["git@github.com:owner/repo.git", undefined, undefined],
    ["https://github.com/owner/repo/tree/main", "main", undefined],
    ["https://github.com/owner/repo/tree/feature/abc", "feature/abc", undefined],
    ["https://github.com/owner/repo/blob/main/src/model.py", "main", "src/model.py"],
    [
      "https://github.com/owner/repo/blob/feature/abc/src/model.py",
      "feature/abc",
      "src/model.py",
    ],
  ])("normalizes %s", (url, ref, sourcePath) => {
    const result = normalizeGitHubRepoUrl(url);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
    expect(result.normalizedUrl).toBe("https://github.com/owner/repo");
    expect(result.ref).toBe(ref);
    expect(result.sourcePath).toBe(sourcePath);
  });

  it("lets explicit ref override URL ref", () => {
    const result = normalizeGitHubRepoUrl(
      "https://github.com/owner/repo/tree/main",
      "dev",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ref).toBe("dev");
  });

  it("rejects non-GitHub URLs", () => {
    const result = normalizeGitHubRepoUrl("https://gitlab.com/owner/repo");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_GITHUB_URL");
  });
});
