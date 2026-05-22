// Central policy for paper-code repository analysis.
// Keep GitHub/tree/read budgets and scoring inputs here so tool code does not
// accumulate magic constants.

export interface CodeContextPolicy {
  codeRepoTreeMaxEntries: number;
  codeMaxSelectedFiles: number;
  codeTotalCharBudget: number;
  codeMaxFileChars: number;
  codeReadmeMaxChars: number;
  codeSearchMaxMatches: number;
  codeRangeMaxLines: number;
  githubRequestTimeoutMs: number;
  githubRequestRetries: number;
  codeAllowedExtensions: string[];
  codeSkipDirs: string[];
  codePriorityFilenames: string[];
  codePriorityDirs: string[];
  codePathKeywords: string[];
}

export const DEFAULT_CODE_CONTEXT_POLICY: CodeContextPolicy = {
  codeRepoTreeMaxEntries: 3000,
  codeMaxSelectedFiles: 24,
  codeTotalCharBudget: 240000,
  codeMaxFileChars: 120000,
  codeReadmeMaxChars: 20000,
  codeSearchMaxMatches: 24,
  codeRangeMaxLines: 220,
  githubRequestTimeoutMs: 20000,
  githubRequestRetries: 2,
  codeAllowedExtensions: [
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".java",
    ".cpp",
    ".cc",
    ".c",
    ".h",
    ".hpp",
    ".rs",
    ".go",
    ".yaml",
    ".yml",
    ".json",
    ".toml",
    ".md",
  ],
  codeSkipDirs: [
    ".git",
    "tests",
    "test",
    "docs",
    "doc",
    "examples",
    "example",
    "demo",
    "demos",
    "node_modules",
    "dist",
    "build",
    "assets",
    "notebooks",
    "notebook",
    "__pycache__",
    ".github",
  ],
  codePriorityFilenames: [
    "model.py",
    "models.py",
    "network.py",
    "module.py",
    "train.py",
    "trainer.py",
    "loss.py",
    "losses.py",
    "dataset.py",
    "datasets.py",
    "data.py",
    "config.py",
    "main.py",
    "eval.py",
    "inference.py",
    "pipeline.py",
  ],
  codePriorityDirs: [
    "models",
    "model",
    "src",
    "core",
    "training",
    "train",
    "losses",
    "data",
    "dataset",
    "datasets",
    "configs",
    "config",
    "modules",
    "networks",
  ],
  codePathKeywords: [
    "model",
    "models",
    "network",
    "module",
    "train",
    "trainer",
    "training",
    "loss",
    "losses",
    "dataset",
    "datasets",
    "data",
    "config",
    "eval",
    "inference",
    "pipeline",
  ],
};
