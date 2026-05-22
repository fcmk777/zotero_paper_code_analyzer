import { describe, expect, it } from "vitest";
import { normalizeGitHubUrl } from "../../src/context/code-github";

describe("normalizeGitHubUrl", () => {
  it.each([
    [
      "https://github.com/owner/repo",
      { owner: "owner", repo: "repo", branch: undefined },
    ],
    [
      "https://github.com/owner/repo.git",
      { owner: "owner", repo: "repo", branch: undefined },
    ],
    [
      "https://github.com/owner/repo/",
      { owner: "owner", repo: "repo", branch: undefined },
    ],
    [
      "https://github.com/owner/repo/tree/main",
      { owner: "owner", repo: "repo", branch: "main" },
    ],
    [
      "https://github.com/owner/repo/tree/dev-branch",
      { owner: "owner", repo: "repo", branch: "dev-branch" },
    ],
  ])("normalizes %s", (input, expected) => {
    const result = normalizeGitHubUrl(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.owner).toBe(expected.owner);
    expect(result.repo).toBe(expected.repo);
    expect(result.branch).toBe(expected.branch);
    expect(result.normalizedUrl).toBe("https://github.com/owner/repo");
  });

  it("lets explicit branch override /tree/<branch>", () => {
    const result = normalizeGitHubUrl(
      "https://github.com/owner/repo/tree/main",
      "dev",
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.branch).toBe("dev");
  });

  it("supports git@github.com SSH syntax", () => {
    const result = normalizeGitHubUrl("git@github.com:owner/repo.git");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.owner).toBe("owner");
      expect(result.repo).toBe("repo");
    }
  });

  it("rejects non-GitHub URLs", () => {
    const result = normalizeGitHubUrl("https://gitlab.com/owner/repo");

    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_GITHUB_URL" },
    });
  });

  it("rejects URLs missing owner/repo", () => {
    const result = normalizeGitHubUrl("https://github.com/owner");

    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_GITHUB_URL" },
    });
  });
});
