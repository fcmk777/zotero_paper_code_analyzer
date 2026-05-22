import { describe, expect, it } from "vitest";
import {
  addLineNumbers,
  formatFilesWithLineNumbers,
  languageForPath,
  selectRelevantFiles,
} from "../../src/context/code-file-select";
import { DEFAULT_CODE_CONTEXT_POLICY } from "../../src/context/code-policy";

describe("code file selection", () => {
  it("prioritizes model, training, loss, dataset, and src/model paths", () => {
    const selected = selectRelevantFiles([
      { path: "model.py", type: "blob", size: 100 },
      { path: "train.py", type: "blob", size: 100 },
      { path: "loss.py", type: "blob", size: 100 },
      { path: "dataset.py", type: "blob", size: 100 },
      { path: "src/models/foo.py", type: "blob", size: 100 },
      { path: "misc/helper.py", type: "blob", size: 100 },
    ]);

    const paths = selected.map((file) => file.path);
    expect(new Set(paths.slice(0, 5))).toEqual(new Set([
      "model.py",
      "train.py",
      "loss.py",
      "dataset.py",
      "src/models/foo.py",
    ]));
    expect(selected[0].score).toBeGreaterThan(selected.at(-1)!.score);
  });

  it("skips noisy directories and disallowed binary extensions", () => {
    const selected = selectRelevantFiles([
      { path: "tests/test_model.py", type: "blob" },
      { path: "docs/usage.md", type: "blob" },
      { path: "examples/demo.py", type: "blob" },
      { path: "node_modules/foo.js", type: "blob" },
      { path: "weights/model.bin", type: "blob" },
      { path: "models/core.py", type: "blob" },
    ]);

    expect(selected.map((file) => file.path)).toEqual(["models/core.py"]);
  });

  it("truncates to max selected files", () => {
    const policy = {
      ...DEFAULT_CODE_CONTEXT_POLICY,
      codeMaxSelectedFiles: 3,
    };
    const selected = selectRelevantFiles(
      Array.from({ length: 10 }, (_, index) => ({
        path: `src/model_${index}.py`,
        type: "blob" as const,
      })),
      policy,
    );

    expect(selected).toHaveLength(3);
  });
});

describe("line numbering and source formatting", () => {
  it("injects stable line numbers", () => {
    const text = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join("\n");
    const numbered = addLineNumbers(text);

    expect(numbered.split("\n")[0]).toMatch(/^   1 \| line 1$/);
    expect(numbered.split("\n")[9]).toMatch(/^  10 \| line 10$/);
  });

  it("marks truncation and respects per-file and total budgets", () => {
    const result = formatFilesWithLineNumbers(
      [
        { path: "model.py", content: "a".repeat(120) },
        { path: "train.py", content: "b".repeat(120) },
      ],
      {
        ...DEFAULT_CODE_CONTEXT_POLICY,
        codeMaxFileChars: 50,
        codeTotalCharBudget: 80,
      },
    );

    expect(result.files[0].truncated).toBe(true);
    expect(result.files[0].chars).toBeLessThanOrEqual(50);
    expect(result.totalChars).toBeLessThanOrEqual(80);
    expect(result.files.every((file) => file.contentMarkdown.endsWith("```"))).toBe(true);
  });

  it("handles empty files deterministically", () => {
    const result = formatFilesWithLineNumbers([
      { path: "empty.py", content: "" },
    ]);

    expect(result.files[0].contentMarkdown).toContain("   1 | ");
    expect(result.files[0].truncated).toBe(false);
  });

  it("infers language tags", () => {
    expect(languageForPath("src/model.py")).toBe("python");
    expect(languageForPath("src/view.tsx")).toBe("typescript");
    expect(languageForPath("README.md")).toBe("markdown");
  });
});
