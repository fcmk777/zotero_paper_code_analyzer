import { describe, expect, it } from "vitest";
import { extractSymbolSkeleton } from "../../../src/context/repo/symbol-extractor";

describe("extractSymbolSkeleton", () => {
  it("extracts Python imports, classes, functions, and entrypoints", () => {
    const skeleton = extractSymbolSkeleton(
      "model.py",
      [
        "import torch",
        "from torch import nn",
        "class Net(nn.Module):",
        "    def forward(self, x):",
        "        return x",
        "def train():",
        "    pass",
        'if __name__ == "__main__":',
      ].join("\n"),
    );

    expect(skeleton.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "import", line: 1 }),
        expect.objectContaining({ kind: "class", name: "Net", line: 3 }),
        expect.objectContaining({ kind: "function", name: "train", line: 6 }),
        expect.objectContaining({ kind: "entrypoint", line: 8 }),
      ]),
    );
  });

  it("extracts TypeScript imports, exports, classes, and arrow functions", () => {
    const skeleton = extractSymbolSkeleton(
      "src/index.ts",
      [
        "import x from './x';",
        "export class Runner {}",
        "export const run = async () => {};",
      ].join("\n"),
    );

    expect(skeleton.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "import", line: 1 }),
        expect.objectContaining({ kind: "export", line: 2 }),
        expect.objectContaining({ kind: "class", name: "Runner", line: 2 }),
        expect.objectContaining({ kind: "function", name: "run", line: 3 }),
      ]),
    );
  });

  it("extracts YAML top-level keys", () => {
    const skeleton = extractSymbolSkeleton(
      "config.yaml",
      "model:\n  name: net\ntraining:\n  lr: 1e-4\n",
    );

    expect(skeleton.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "config_key", name: "model", line: 1 }),
        expect.objectContaining({
          kind: "config_key",
          name: "training",
          line: 3,
        }),
      ]),
    );
  });

  it("extracts notebook headings without treating the full JSON as source", () => {
    const skeleton = extractSymbolSkeleton(
      "demo.ipynb",
      JSON.stringify({
        cells: [
          { cell_type: "markdown", source: ["# Method\n"] },
          { cell_type: "code", source: ["class Demo:\n", "    pass\n"] },
        ],
      }),
    );

    expect(skeleton.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "notebook_heading", name: "Method" }),
        expect.objectContaining({ kind: "notebook_code" }),
      ]),
    );
  });
});
