import { beforeEach, describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { createRepoWorkspaceTools } from "../../../src/context/repo/repo-tools";
import type { ContextSource } from "../../../src/context/builder";

let files: Record<string, string>;

const source: ContextSource = {
  getItem: async () => ({
    title: "Motion Paper",
    authors: ["A"],
    year: 2026,
    abstract: "A transformer model with training objective.",
    tags: [],
  }),
  getFullText: async () =>
    "Abstract\nThis paper proposes a model.\nMethod\nThe model uses a transformer.\nExperiments\nTraining uses MSE loss.",
  getAnnotations: async () => [
    { type: "highlight", text: "important method", pageLabel: "3" },
  ],
};

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

describe("repo workspace tools", () => {
  it("exposes V2 tools and reports no current item structurally", async () => {
    const tools = createRepoWorkspaceTools({
      itemID: null,
      source,
      fetchImpl: mockFetch(),
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      "repo_import_github_archive",
      "repo_get_workspace_status",
      "repo_get_manifest",
      "repo_get_module_map",
      "repo_get_symbol_skeleton",
      "repo_search_files",
      "repo_read_file_with_lines",
      "repo_read_related_files",
      "paper_build_context_digest",
      "paper_get_context_digest",
      "paper_search_sections",
      "paper_read_section",
      "analysis_save_report",
      "analysis_get_saved_report",
    ]);

    const result = await tools[0].execute({
      githubUrl: "https://github.com/o/r",
    });
    const json = JSON.parse(result.output);
    expect(json.ok).toBe(false);
    expect(json.code).toBe("NO_CURRENT_ZOTERO_ITEM");
  });

  it("imports a GitHub archive, indexes files, and reads local lines", async () => {
    const tools = createRepoWorkspaceTools({
      itemID: 1,
      source,
      fetchImpl: mockFetch(),
    });
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    const imported = JSON.parse(
      (
        await byName.get("repo_import_github_archive")!.execute({
          githubUrl: "https://github.com/o/r",
        })
      ).output,
    );
    expect(imported.ok).toBe(true);
    expect(imported.indexedTextFiles).toBeGreaterThanOrEqual(4);
    expect(imported.readmePaths).toContain("README.md");
    expect(imported.likelyEntryFiles).toContain("train.py");

    const moduleMap = JSON.parse(
      (await byName.get("repo_get_module_map")!.execute({})).output,
    );
    expect(moduleMap.moduleMap.likelyPipelines.modelFiles).toContain(
      "src/models/model.py",
    );
    expect(moduleMap.moduleMap.likelyPipelines.trainingFiles).toContain(
      "train.py",
    );

    const read = JSON.parse(
      (
        await byName.get("repo_read_file_with_lines")!.execute({
          path: "src/models/model.py",
          startLine: 1,
          endLine: 3,
        })
      ).output,
    );
    expect(read.file.contentMarkdown).toContain("   1 | import torch");
    expect(read.file.contentMarkdown).toContain("   3 | class Net");

    const paper = JSON.parse(
      (
        await byName.get("paper_build_context_digest")!.execute({
          includeAnnotations: true,
        })
      ).output,
    );
    expect(paper.ok).toBe(true);
    expect(paper.digest.title).toBe("Motion Paper");
    expect(paper.digest.availableTextChars).toBeGreaterThan(0);
  });
});

function mockFetch(): typeof fetch {
  const zip = zipSync({
    "o-r-sha/README.md": strToU8("# Repo\n"),
    "o-r-sha/src/models/model.py": strToU8(
      "import torch\n\nclass Net:\n    def forward(self, x):\n        return x\n",
    ),
    "o-r-sha/train.py": strToU8(
      'from src.models.model import Net\n\nif __name__ == "__main__":\n    Net()\n',
    ),
    "o-r-sha/losses/criterion.py": strToU8(
      "def loss(x, y):\n    return x - y\n",
    ),
    "o-r-sha/data/dataset.py": strToU8("class Dataset:\n    pass\n"),
    "o-r-sha/docs/example.py": strToU8("print('skip')\n"),
    "o-r-sha/assets/pic.bin": new Uint8Array([1, 2, 0, 3]),
  });
  return (async (url: RequestInfo | URL) => {
    const value = String(url);
    if (value === "https://api.github.com/repos/o/r") {
      return new Response(
        JSON.stringify({
          default_branch: "main",
          html_url: "https://github.com/o/r",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (value === "https://api.github.com/repos/o/r/commits/main") {
      return new Response(JSON.stringify({ sha: "sha" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (value === "https://api.github.com/repos/o/r/zipball/main") {
      return new Response(zip, {
        status: 200,
        headers: {
          "content-type": "application/zip",
          "content-length": String(zip.byteLength),
        },
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}
