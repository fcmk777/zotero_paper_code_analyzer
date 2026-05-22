import { describe, expect, it } from "vitest";
import { classifyRepoFile } from "../../../src/context/repo/file-classifier";
import { DEFAULT_REPO_POLICY } from "../../../src/context/repo/repo-policy";

const enc = new TextEncoder();

describe("classifyRepoFile", () => {
  it.each([
    ["src/models/model.py", "model_architecture"],
    ["train.py", "training_entry"],
    ["losses/criterion.py", "loss_objective"],
    ["data/dataset.py", "dataset_pipeline"],
  ])("scores and tags %s", (path, tag) => {
    const result = classifyRepoFile(
      path,
      enc.encode("import torch\nclass Model:\n    pass\n"),
      DEFAULT_REPO_POLICY,
    );

    expect(result.meta.isSkipped).toBe(false);
    expect(result.meta.importanceScore).toBeGreaterThan(40);
    expect(result.meta.roleTags).toContain(tag);
    expect(result.text).toContain("import torch");
  });

  it.each(["docs/example.py", "examples/demo.py", "node_modules/foo.js"])(
    "skips noisy paths %s",
    (path) => {
      const result = classifyRepoFile(path, enc.encode("print('x')"), DEFAULT_REPO_POLICY);

      expect(result.meta.isSkipped).toBe(true);
      expect(result.meta.skipReason).toMatch(/ignored_dir/);
    },
  );

  it("skips binary files", () => {
    const result = classifyRepoFile(
      "src/model.py",
      new Uint8Array([1, 2, 0, 3]),
      DEFAULT_REPO_POLICY,
    );

    expect(result.meta.isBinary).toBe(true);
    expect(result.meta.isSkipped).toBe(true);
  });
});
