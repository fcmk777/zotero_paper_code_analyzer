import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCodeAnalysisTools } from "../../src/context/code-tools";
import type { ContextSource } from "../../src/context/builder";

let stored = "";

const source: ContextSource = {
  getItem: async () => ({
    title: "A Model Training Paper",
    authors: ["Ada"],
    year: 2026,
    abstract: "This paper proposes a model and training loss.",
    tags: ["model"],
  }),
  getFullText: async () => "",
};

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

describe("createCodeAnalysisTools", () => {
  it("exposes AgentTool-compatible code tools", () => {
    const tools = createCodeAnalysisTools({ itemID: 1, source });

    expect(tools.map((tool) => tool.name)).toEqual([
      "code_get_bound_repository",
      "code_bind_repository",
      "code_fetch_repo_tree",
      "code_select_relevant_files",
      "code_read_files_with_line_numbers",
      "code_search_in_files",
      "code_read_file_ranges_with_line_numbers",
      "code_get_repository_readme",
      "code_save_analysis",
      "code_get_saved_analysis",
    ]);
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toMatchObject({ type: "object" });
      expect(typeof tool.execute).toBe("function");
    }
    expect(
      tools.find((tool) => tool.name === "code_save_analysis")
        ?.requiresApproval,
    ).toBe(true);
  });

  it("returns structured errors for missing current item and missing args", async () => {
    const noItemTools = createCodeAnalysisTools({ itemID: null, source });
    const getBound = noItemTools.find(
      (tool) => tool.name === "code_get_bound_repository",
    )!;
    const bind = createCodeAnalysisTools({ itemID: 1, source }).find(
      (tool) => tool.name === "code_bind_repository",
    )!;

    const noItem = await getBound.execute({});
    const missingArg = await bind.execute({});

    expect(JSON.parse(noItem.output)).toMatchObject({
      ok: false,
      error: { code: "NO_CURRENT_ITEM" },
    });
    expect(JSON.parse(missingArg.output)).toMatchObject({
      ok: false,
      error: { code: "INVALID_GITHUB_URL" },
    });
  });

  it("binds and reads a repository through storage", async () => {
    const tools = createCodeAnalysisTools({ itemID: 1, source });
    const bind = tools.find((tool) => tool.name === "code_bind_repository")!;
    const getBound = tools.find(
      (tool) => tool.name === "code_get_bound_repository",
    )!;

    const bound = await bind.execute({
      githubUrl: "https://github.com/owner/repo/tree/main",
    });
    const loaded = await getBound.execute({});

    expect(JSON.parse(bound.output)).toMatchObject({
      ok: true,
      itemID: 1,
      githubUrl: "https://github.com/owner/repo",
      branch: "main",
    });
    expect(JSON.parse(loaded.output)).toMatchObject({
      ok: true,
      owner: "owner",
      repo: "repo",
      branch: "main",
    });
  });

  it("uses a bound repository when githubUrl is omitted", async () => {
    const fetchImpl = fakeGitHubFetch();
    const tools = createCodeAnalysisTools({ itemID: 1, source, fetchImpl });
    await tools
      .find((tool) => tool.name === "code_bind_repository")!
      .execute({
        githubUrl: "https://github.com/owner/repo",
      });
    const fetchTree = tools.find(
      (tool) => tool.name === "code_fetch_repo_tree",
    )!;

    const result = await fetchTree.execute({});
    const body = JSON.parse(result.output);

    expect(body).toMatchObject({
      ok: true,
      githubUrl: "https://github.com/owner/repo",
      branch: "main",
    });
    expect(
      body.candidateFiles.map((file: { path: string }) => file.path),
    ).toContain("model.py");
  });

  it("selects, reads/searches ranges with line numbers, reads README, and saves analysis", async () => {
    const fetchImpl = fakeGitHubFetch();
    const tools = createCodeAnalysisTools({ itemID: 1, source, fetchImpl });
    const select = tools.find(
      (tool) => tool.name === "code_select_relevant_files",
    )!;
    const read = tools.find(
      (tool) => tool.name === "code_read_files_with_line_numbers",
    )!;
    const search = tools.find((tool) => tool.name === "code_search_in_files")!;
    const rangeRead = tools.find(
      (tool) => tool.name === "code_read_file_ranges_with_line_numbers",
    )!;
    const readme = tools.find(
      (tool) => tool.name === "code_get_repository_readme",
    )!;
    const save = tools.find((tool) => tool.name === "code_save_analysis")!;
    const getSaved = tools.find(
      (tool) => tool.name === "code_get_saved_analysis",
    )!;

    const selected = JSON.parse(
      (await select.execute({ githubUrl: "https://github.com/owner/repo" }))
        .output,
    );
    expect(selected.ok).toBe(true);
    expect(selected.selectedFiles[0].path).toBe("model.py");

    const readResult = JSON.parse(
      (
        await read.execute({
          githubUrl: "https://github.com/owner/repo",
          paths: ["model.py", "train.py"],
        })
      ).output,
    );
    expect(readResult.ok).toBe(true);
    expect(readResult.files[0].contentMarkdown).toContain("   1 | class Model");

    const searchResult = JSON.parse(
      (
        await search.execute({
          githubUrl: "https://github.com/owner/repo",
          paths: ["model.py"],
          queries: ["forward"],
        })
      ).output,
    );
    expect(searchResult.ok).toBe(true);
    expect(searchResult.matches[0]).toMatchObject({
      path: "model.py",
      lineNumber: 3,
    });

    const rangeResult = JSON.parse(
      (
        await rangeRead.execute({
          githubUrl: "https://github.com/owner/repo",
          ranges: [{ path: "model.py", startLine: 2, endLine: 4 }],
        })
      ).output,
    );
    expect(rangeResult.ok).toBe(true);
    expect(rangeResult.files[0].contentMarkdown).toContain(
      "   3 |     def forward",
    );

    const readmeResult = JSON.parse(
      (await readme.execute({ githubUrl: "https://github.com/owner/repo" }))
        .output,
    );
    expect(readmeResult.ok).toBe(true);
    expect(readmeResult.path).toBe("README.md");

    const saved = JSON.parse(
      (
        await save.execute({
          githubUrl: "https://github.com/owner/repo",
          sections: ["模型架构"],
          analysisMarkdown: "# report",
        })
      ).output,
    );
    expect(saved).toMatchObject({ ok: true, itemID: 1, markdownChars: 8 });

    const loaded = JSON.parse((await getSaved.execute({})).output);
    expect(loaded).toMatchObject({
      ok: true,
      itemID: 1,
      markdown: "# report",
      sections: ["模型架构"],
    });
  });

  it("reports missing saved analysis", async () => {
    const tool = createCodeAnalysisTools({ itemID: 1, source }).find(
      (candidate) => candidate.name === "code_get_saved_analysis",
    )!;

    const result = await tool.execute({});

    expect(JSON.parse(result.output)).toMatchObject({
      ok: false,
      error: { code: "NO_SAVED_CODE_ANALYSIS" },
    });
  });
});

function fakeGitHubFetch(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "https://api.github.com/repos/owner/repo") {
      return jsonResponse({ default_branch: "main" });
    }
    if (url.includes("/git/trees/main")) {
      return jsonResponse({
        truncated: false,
        tree: [
          { path: "model.py", type: "blob", size: 20 },
          { path: "train.py", type: "blob", size: 20 },
          { path: "docs/usage.md", type: "blob", size: 20 },
        ],
      });
    }
    if (url.includes("/contents/README.md")) {
      return jsonResponse({
        type: "file",
        encoding: "base64",
        content: encodeBase64("# Repo\nUse train.py"),
        size: 19,
      });
    }
    if (url.includes("/contents/model.py")) {
      return jsonResponse({
        type: "file",
        encoding: "base64",
        content: encodeBase64(
          "class Model:\n    def __init__(self):\n    def forward(self, x):\n        return x",
        ),
        size: 75,
      });
    }
    if (url.includes("/contents/train.py")) {
      return jsonResponse({
        type: "file",
        encoding: "base64",
        content: encodeBase64("def train():\n    return 1"),
        size: 25,
      });
    }
    return jsonResponse({ message: "not found" }, 404);
  }) as unknown as typeof fetch;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function encodeBase64(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64");
}
