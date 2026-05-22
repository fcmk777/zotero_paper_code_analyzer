export type RepoRoleTag =
  | "readme"
  | "config"
  | "model_architecture"
  | "training_entry"
  | "loss_objective"
  | "dataset_pipeline"
  | "evaluation"
  | "inference"
  | "utility"
  | "package_metadata"
  | "notebook";

export interface RepoToolError {
  ok: false;
  code: string;
  message: string;
  recoverable: boolean;
  suggestion?: string;
  details?: unknown;
}

export type RepoResult<T> = ({ ok: true } & T) | RepoToolError;

export interface NormalizedGitHubRepo {
  provider: "github";
  owner: string;
  repo: string;
  ref?: string;
  originalUrl: string;
  normalizedUrl: string;
  sourcePath?: string;
}

export interface ResolvedRepoRef {
  owner: string;
  repo: string;
  ref: string;
  defaultBranch: string;
  commitSha?: string;
  archiveUrl: string;
  webUrl: string;
}

export interface RepoFileMeta {
  path: string;
  normalizedPath: string;
  ext: string;
  language: string;
  sizeBytes: number;
  lineCount?: number;
  isText: boolean;
  isBinary: boolean;
  isSkipped: boolean;
  skipReason?: string;
  importanceScore: number;
  importanceReasons: string[];
  roleTags: RepoRoleTag[];
  hash?: string;
  lfsPointer?: boolean;
}

export interface RepoSymbol {
  kind:
    | "import"
    | "class"
    | "function"
    | "entrypoint"
    | "export"
    | "config_key"
    | "notebook_heading"
    | "notebook_code";
  name: string;
  line: number;
  detail?: string;
}

export interface RepoSymbolSkeleton {
  path: string;
  language: string;
  symbols: RepoSymbol[];
  summary: string;
  truncated: boolean;
}

export interface RepoModuleMap {
  workspaceId: string;
  topLevelDirs: string[];
  languageStats: Record<string, number>;
  roleGroups: Record<string, string[]>;
  likelyPipelines: {
    modelFiles: string[];
    trainingFiles: string[];
    datasetFiles: string[];
    lossFiles: string[];
    evalFiles: string[];
    configFiles: string[];
  };
  entrypointCandidates: string[];
  warnings: string[];
}

export interface RepoWorkspaceFile {
  meta: RepoFileMeta;
  content?: string;
  contentTruncated?: boolean;
  symbolSkeleton?: RepoSymbolSkeleton;
}

export interface RepoWorkspaceSummary {
  workspaceId: string;
  owner: string;
  repo: string;
  ref: string;
  commitSha?: string;
  webUrl: string;
  importedAt: number;
  totalEntries: number;
  totalFiles: number;
  indexedTextFiles: number;
  skippedBinaryFiles: number;
  skippedLargeFiles: number;
  skippedByIgnoreRules: number;
  totalTextBytes: number;
  languages: Record<string, number>;
  topLevelDirs: string[];
  readmePaths: string[];
  configPaths: string[];
  likelyEntryFiles: string[];
  warnings: string[];
}

export interface RepoWorkspace extends RepoWorkspaceSummary {
  manifest: RepoFileMeta[];
  files: Record<string, RepoWorkspaceFile>;
  moduleMap: RepoModuleMap;
}

export interface PaperContextSection {
  title: string;
  startOffset?: number;
  endOffset?: number;
  summary?: string;
  text?: string;
}

export interface PaperContextDigest {
  itemID: number;
  title: string;
  authors: string[];
  year?: string;
  abstract?: string;
  sectionOutline: PaperContextSection[];
  methodKeywords: string[];
  experimentKeywords: string[];
  annotationsSummary?: string;
  availableTextChars: number;
  warnings: string[];
}

export interface RepoAnalysisReport {
  itemID: number;
  workspaceId: string;
  githubUrl: string;
  owner: string;
  repo: string;
  ref: string;
  commitSha?: string;
  sections: string[];
  markdown: string;
  createdAt: number;
  updatedAt: number;
}

export function repoError(
  code: string,
  message: string,
  recoverable = true,
  suggestion?: string,
  details?: unknown,
): RepoToolError {
  return {
    ok: false,
    code,
    message,
    recoverable,
    ...(suggestion ? { suggestion } : {}),
    ...(details !== undefined ? { details } : {}),
  };
}
