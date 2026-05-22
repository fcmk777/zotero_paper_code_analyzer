import type { RepoContextPolicy } from "./repo-policy";
import type { RepoFileMeta, RepoRoleTag } from "./types";

const TEXT_DECODER = new TextDecoder("utf-8", { fatal: false });

export interface ClassifiedRepoFile {
  meta: RepoFileMeta;
  text?: string;
}

export function classifyRepoFile(
  path: string,
  bytes: Uint8Array,
  policy: RepoContextPolicy,
): ClassifiedRepoFile {
  const normalizedPath = normalizeRepoPath(path);
  const ext = extensionForPath(normalizedPath);
  const basename = basenameForPath(normalizedPath).toLowerCase();
  const language = languageForPath(normalizedPath);
  const ignoreReason = ignoredPathReason(normalizedPath, policy);
  const allowed = isAllowedTextPath(normalizedPath, policy);
  const binary = isLikelyBinaryBytes(bytes);
  const lfsPointer = isGitLfsPointer(bytes);
  const tooLarge = bytes.byteLength > policy.maxSingleFileBytes;
  const skipReason =
    ignoreReason ||
    (!allowed ? "unsupported_extension" : "") ||
    (binary ? "binary_file" : "") ||
    (tooLarge ? "single_file_too_large" : "");
  const text =
    !skipReason && !binary ? normalizeNewlines(TEXT_DECODER.decode(bytes)) : "";
  const roleTags = roleTagsForPath(normalizedPath, language);
  const score = importanceScoreForPath(normalizedPath, bytes.byteLength, policy);
  return {
    meta: {
      path: normalizedPath,
      normalizedPath,
      ext,
      language,
      sizeBytes: bytes.byteLength,
      ...(text ? { lineCount: lineCount(text) } : {}),
      isText: !!text && !binary,
      isBinary: binary,
      isSkipped: !!skipReason,
      ...(skipReason ? { skipReason } : {}),
      importanceScore: score.score,
      importanceReasons: score.reasons,
      roleTags,
      ...(lfsPointer ? { lfsPointer: true } : {}),
      hash: lightweightHash(bytes),
    },
    ...(text ? { text } : {}),
  };
}

export function normalizeRepoPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}

export function isAllowedTextPath(
  path: string,
  policy: RepoContextPolicy,
): boolean {
  const normalized = normalizeRepoPath(path);
  const basename = basenameForPath(normalized).toLowerCase();
  const ext = extensionForPath(normalized);
  if (basename.startsWith("readme")) return true;
  if (policy.allowedBasenames.includes(basename)) return true;
  return policy.allowedExtensions.includes(ext);
}

export function ignoredPathReason(
  path: string,
  policy: RepoContextPolicy,
): string {
  const normalized = normalizeRepoPath(path);
  const segments = normalized
    .split("/")
    .slice(0, -1)
    .map((segment) => segment.toLowerCase());
  const basename = basenameForPath(normalized).toLowerCase();
  for (const segment of segments) {
    if (!policy.ignoredDirs.includes(segment)) continue;
    if (isCodeDataDirectoryException(segment, basename)) continue;
    return `ignored_dir:${segment}`;
  }
  return "";
}

export function isLikelyBinaryBytes(bytes: Uint8Array): boolean {
  const sample = bytes.slice(0, Math.min(bytes.byteLength, 4096));
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}

export function isGitLfsPointer(bytes: Uint8Array): boolean {
  if (bytes.byteLength > 1024) return false;
  const text = TEXT_DECODER.decode(bytes);
  return (
    text.startsWith("version https://git-lfs.github.com/spec/v1") &&
    /\boid sha256:[a-f0-9]{64}\b/.test(text)
  );
}

export function languageForPath(path: string): string {
  const lower = normalizeRepoPath(path).toLowerCase();
  const basename = basenameForPath(lower);
  if (basename === "dockerfile") return "dockerfile";
  if (basename === "makefile") return "makefile";
  if (basename.startsWith("readme")) return "markdown";
  switch (extensionForPath(lower)) {
    case ".py":
      return "python";
    case ".ipynb":
      return "jupyter";
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".js":
    case ".jsx":
      return "javascript";
    case ".java":
      return "java";
    case ".kt":
      return "kotlin";
    case ".scala":
      return "scala";
    case ".cpp":
    case ".cc":
    case ".hpp":
      return "cpp";
    case ".c":
    case ".h":
      return "c";
    case ".rs":
      return "rust";
    case ".go":
      return "go";
    case ".swift":
      return "swift";
    case ".yaml":
    case ".yml":
      return "yaml";
    case ".json":
      return "json";
    case ".toml":
      return "toml";
    case ".ini":
    case ".cfg":
    case ".conf":
      return "config";
    case ".md":
      return "markdown";
    case ".rst":
      return "rst";
    case ".txt":
      return "text";
    default:
      return "text";
  }
}

export function extensionForPath(path: string): string {
  const basename = basenameForPath(path);
  const index = basename.lastIndexOf(".");
  return index > 0 ? basename.slice(index).toLowerCase() : "";
}

export function roleTagsForPath(path: string, language = languageForPath(path)): RepoRoleTag[] {
  const lower = normalizeRepoPath(path).toLowerCase();
  const basename = basenameForPath(lower);
  const segments = lower.split("/");
  const joined = `/${segments.join("/")}/`;
  const tags = new Set<RepoRoleTag>();
  if (basename.startsWith("readme") || language === "markdown") tags.add("readme");
  if (
    /(^|\/)(configs?|default)\//.test(joined) ||
    /(config|default)\.(py|ya?ml|json|toml|ini|cfg|conf)$/.test(lower) ||
    ["requirements.txt", "environment.yml", "pyproject.toml", "setup.cfg", "package.json"].includes(basename)
  ) {
    tags.add("config");
  }
  if (/(model|models|network|networks|module|modules|architecture|backbone|encoder|decoder|transformer)/.test(lower)) {
    tags.add("model_architecture");
  }
  if (/(^|\/)(train|training|trainer|engine|finetune|main|run)\b/.test(lower) || /(train|trainer|training|finetune)\.(py|ts|js)$/.test(lower)) {
    tags.add("training_entry");
  }
  if (/(loss|losses|criterion|criterions|objective)/.test(lower)) {
    tags.add("loss_objective");
  }
  if (/(dataset|datasets|dataloader|transforms|datamodule|data_pipe|data\/|\/data\.)/.test(lower)) {
    tags.add("dataset_pipeline");
  }
  if (/(eval|evaluate|evaluation|metrics|test)\b/.test(lower)) {
    tags.add("evaluation");
  }
  if (/(inference|infer|predict|serve|demo)\b/.test(lower)) {
    tags.add("inference");
  }
  if (["setup.py", "pyproject.toml", "package.json"].includes(basename)) {
    tags.add("package_metadata");
  }
  if (language === "jupyter") tags.add("notebook");
  if (!tags.size) tags.add("utility");
  return Array.from(tags);
}

export function importanceScoreForPath(
  path: string,
  sizeBytes: number,
  policy: RepoContextPolicy,
): { score: number; reasons: string[] } {
  const lower = normalizeRepoPath(path).toLowerCase();
  const basename = basenameForPath(lower);
  const segments = lower.split("/").slice(0, -1);
  let score = 10;
  const reasons: string[] = ["readable source/config candidate"];
  if (policy.priorityFilenames.includes(basename)) {
    score += 45;
    reasons.push(`priority filename:${basename}`);
  }
  const matchedDirs = segments.filter((segment) =>
    policy.priorityDirs.includes(segment),
  );
  if (matchedDirs.length) {
    score += Math.min(25, matchedDirs.length * 10);
    reasons.push(`priority dir:${matchedDirs.slice(0, 3).join("/")}`);
  }
  const roles = roleTagsForPath(lower).filter((tag) => tag !== "utility");
  if (roles.length) {
    score += Math.min(35, roles.length * 12);
    reasons.push(`role:${roles.join(",")}`);
  }
  if (basename.startsWith("readme")) score += 8;
  if (sizeBytes > 200_000) {
    score -= 10;
    reasons.push("large file penalty");
  }
  if (sizeBytes > 500_000) score -= 15;
  return { score: Math.max(0, score), reasons };
}

function isCodeDataDirectoryException(segment: string, basename: string): boolean {
  if (segment !== "data" && segment !== "datasets") return false;
  return /^(dataset|datasets|dataloader|data|transforms|datamodule)\.(py|ts|js|java|go|rs)$/.test(
    basename,
  );
}

function basenameForPath(path: string): string {
  return normalizeRepoPath(path).split("/").pop() ?? "";
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function lineCount(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

function lightweightHash(bytes: Uint8Array): string {
  let hash = 2166136261;
  for (let index = 0; index < bytes.byteLength; index++) {
    hash ^= bytes[index];
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
