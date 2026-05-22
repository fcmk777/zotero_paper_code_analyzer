import { beforeEach, describe, expect, it } from "vitest";
import {
  loadCodeAnalysis,
  loadCodeRepoBinding,
  saveCodeAnalysis,
  saveCodeRepoBinding,
} from "../../src/settings/code-analysis-storage";

let stored = "";

beforeEach(() => {
  stored = "";
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: {
      Profile: { dir: "/profile" },
      File: {
        getContentsAsync: async () => {
          if (!stored) throw new Error("missing");
          return stored;
        },
        putContentsAsync: async (_path: string, contents: string) => {
          stored = contents;
        },
      },
    },
  });
});

describe("code analysis storage", () => {
  it("saves and loads a repository binding by item", async () => {
    const saved = await saveCodeRepoBinding(
      1,
      {
        githubUrl: "https://github.com/owner/repo",
        owner: "owner",
        repo: "repo",
        branch: "main",
      },
      { now: () => 100 },
    );

    expect(saved.ok).toBe(true);
    const loaded = await loadCodeRepoBinding(1);
    expect(loaded).toMatchObject({
      ok: true,
      binding: {
        itemID: 1,
        githubUrl: "https://github.com/owner/repo",
        branch: "main",
        createdAt: 100,
        updatedAt: 100,
      },
    });
  });

  it("saves and reads analysis without cross-item pollution", async () => {
    await saveCodeAnalysis(
      1,
      {
        githubUrl: "https://github.com/a/one",
        owner: "a",
        repo: "one",
        sections: ["模型架构"],
        markdown: "# one",
      },
      { now: () => 100 },
    );
    await saveCodeAnalysis(
      2,
      {
        githubUrl: "https://github.com/b/two",
        owner: "b",
        repo: "two",
        sections: ["训练流程"],
        markdown: "# two",
      },
      { now: () => 200 },
    );

    const first = await loadCodeAnalysis(1);
    const second = await loadCodeAnalysis(2);
    expect(first.ok && first.analysis.markdown).toBe("# one");
    expect(second.ok && second.analysis.markdown).toBe("# two");
  });

  it("preserves createdAt and updates updatedAt for the same item", async () => {
    await saveCodeAnalysis(
      1,
      {
        githubUrl: "https://github.com/a/repo",
        owner: "a",
        repo: "repo",
        sections: ["模型架构"],
        markdown: "first",
      },
      { now: () => 100 },
    );
    const updated = await saveCodeAnalysis(
      1,
      {
        githubUrl: "https://github.com/a/repo",
        owner: "a",
        repo: "repo",
        sections: ["主要创新"],
        markdown: "second",
      },
      { now: () => 300 },
    );

    expect(updated).toMatchObject({
      ok: true,
      analysis: { createdAt: 100, updatedAt: 300, markdown: "second" },
    });
  });

  it("reports missing item and missing analysis with structured errors", async () => {
    await expect(loadCodeAnalysis(null)).resolves.toMatchObject({
      ok: false,
      error: { code: "NO_CURRENT_ITEM" },
    });
    await expect(loadCodeAnalysis(99)).resolves.toMatchObject({
      ok: false,
      error: { code: "NO_SAVED_CODE_ANALYSIS" },
    });
  });
});
