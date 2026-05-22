import { describe, expect, it } from "vitest";
import {
  readFileSliceWithLineNumbers,
  withLineNumbers,
} from "../../../src/context/repo/line-number";
import { DEFAULT_REPO_POLICY } from "../../../src/context/repo/repo-policy";

describe("line numbering", () => {
  it("formats stable line prefixes", () => {
    const numbered = withLineNumbers(Array.from({ length: 10 }, (_, i) => `L${i + 1}`).join("\n"));

    expect(numbered.split("\n")[0]).toBe("   1 | L1");
    expect(numbered.split("\n")[9]).toBe("  10 | L10");
  });

  it("keeps original line numbers for ranges", () => {
    const slice = readFileSliceWithLineNumbers(
      "src/model.py",
      "a\nb\nc\nd",
      DEFAULT_REPO_POLICY,
      3,
      4,
    );

    expect(slice.contentMarkdown).toContain("   3 | c");
    expect(slice.contentMarkdown).toContain("   4 | d");
    expect(slice.returnedLines).toBe("3-4");
  });

  it("marks truncation when budget is exceeded", () => {
    const slice = readFileSliceWithLineNumbers(
      "src/model.py",
      "a".repeat(1000),
      { ...DEFAULT_REPO_POLICY, maxReadFileChars: 80 },
    );

    expect(slice.truncated).toBe(true);
    expect(slice.chars).toBeLessThanOrEqual(220);
  });
});
