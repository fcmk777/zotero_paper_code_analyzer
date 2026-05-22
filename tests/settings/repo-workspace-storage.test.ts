import { beforeEach, describe, expect, it } from "vitest";
import {
  bindRepoWorkspaceToItem,
  loadBoundRepoWorkspace,
  loadRepoAnalysisReport,
  saveRepoAnalysisReport,
  saveRepoWorkspace,
} from "../../src/settings/repo-workspace-storage";
import type { RepoWorkspace } from "../../src/context/repo/types";

let files: Record<string, string>;

beforeEach(() => {
  files = {};
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: {
      Profile: { dir: "profile" },
      File: {
        getContentsAsync: async (path: string) => {
          if (!(path in files)) throw new Error("missing");
          return files[path];
        },
        putContentsAsync: async (path: string, contents: string) => {
          files[path] = contents;
        },
      },
    },
  });
});

describe("repo workspace storage", () => {
  it("saves a workspace and binds it per item", async () => {
    const workspace = fixtureWorkspace("github:o/r@sha");

    await expect(saveRepoWorkspace(workspace)).resolves.toMatchObject({ ok: true });
    await expect(bindRepoWorkspaceToItem(1, workspace.workspaceId)).resolves.toMatchObject({ ok: true });
    await expect(loadBoundRepoWorkspace(1)).resolves.toMatchObject({
      ok: true,
      workspace: { workspaceId: workspace.workspaceId },
    });
    await expect(loadBoundRepoWorkspace(2)).resolves.toMatchObject({
      ok: false,
      code: "NO_REPO_WORKSPACE",
    });
  });

  it("preserves report createdAt when updating", async () => {
    const workspace = fixtureWorkspace("github:o/r@sha");
    await saveRepoWorkspace(workspace);
    await bindRepoWorkspaceToItem(1, workspace.workspaceId);

    const first = await saveRepoAnalysisReport(
      1,
      workspace,
      { markdown: "first", sections: ["模型架构"] },
      { now: () => 100 },
    );
    const second = await saveRepoAnalysisReport(
      1,
      workspace,
      { markdown: "second", sections: ["训练流程"] },
      { now: () => 200 },
    );
    const loaded = await loadRepoAnalysisReport(1, workspace.workspaceId);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.report.createdAt).toBe(100);
    expect(loaded.report.updatedAt).toBe(200);
    expect(loaded.report.markdown).toBe("second");
  });
});

function fixtureWorkspace(workspaceId: string): RepoWorkspace {
  return {
    workspaceId,
    owner: "o",
    repo: "r",
    ref: "main",
    commitSha: "sha",
    webUrl: "https://github.com/o/r/tree/main",
    importedAt: 1,
    totalEntries: 1,
    totalFiles: 1,
    indexedTextFiles: 1,
    skippedBinaryFiles: 0,
    skippedLargeFiles: 0,
    skippedByIgnoreRules: 0,
    totalTextBytes: 10,
    languages: { python: 1 },
    topLevelDirs: ["src"],
    readmePaths: [],
    configPaths: [],
    likelyEntryFiles: ["train.py"],
    warnings: [],
    manifest: [],
    files: {},
    moduleMap: {
      workspaceId,
      topLevelDirs: ["src"],
      languageStats: { python: 1 },
      roleGroups: {},
      likelyPipelines: {
        modelFiles: [],
        trainingFiles: ["train.py"],
        datasetFiles: [],
        lossFiles: [],
        evalFiles: [],
        configFiles: [],
      },
      entrypointCandidates: ["train.py"],
      warnings: [],
    },
  };
}
