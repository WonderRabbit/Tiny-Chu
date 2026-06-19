import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { portableRelative, resolveExistingPathInsideRoot } from "../state/path-safety.js";

export type RepoLayerName = "ui" | "api" | "database" | "domain" | "config" | "test";

export interface RepoMapFile {
  readonly path: string;
  readonly layer: RepoLayerName;
  readonly reason: string;
}

export interface RepoMapLayer {
  readonly name: RepoLayerName;
  readonly files: readonly string[];
  readonly evidence: readonly string[];
}

export interface RepoDataFlowHint {
  readonly from: RepoLayerName;
  readonly to: RepoLayerName;
  readonly evidence: readonly string[];
}

export interface RepoMapResult {
  readonly root: string;
  readonly scannedFiles: number;
  readonly files: readonly RepoMapFile[];
  readonly layers: readonly RepoMapLayer[];
  readonly dataFlowHints: readonly RepoDataFlowHint[];
  readonly recommendedCommands: readonly string[];
}

const EXCLUDED_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".tiny", ".omo"]);
const INCLUDED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".md", ".sql", ".prisma", ".graphql", ".yml", ".yaml"]);
const LAYER_ORDER: readonly RepoLayerName[] = ["ui", "api", "database", "domain", "config", "test"];

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function targetPath(value: unknown): string {
  return typeof value === "string" && value.trim() !== "" ? value : ".";
}

async function collectFiles(root: string, dir: string, limit: number, acc: string[]): Promise<void> {
  if (acc.length >= limit) return;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (acc.length >= limit) return;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) await collectFiles(root, absolute, limit, acc);
      continue;
    }
    if (!entry.isFile() || !INCLUDED_EXTENSIONS.has(path.extname(entry.name))) continue;
    acc.push(portableRelative(root, absolute));
  }
}

function classify(relativePath: string, content: string): RepoMapFile {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  if (/\b(test|spec)\b|\.test\.|\.spec\./.test(normalized)) return { path: relativePath, layer: "test", reason: "test path or filename" };
  if (/package\.json|tsconfig|\.ya?ml$|\.json$/.test(normalized)) return { path: relativePath, layer: "config", reason: "configuration file" };
  if (/(^|\/)(opencode|state|context|dispatcher|wiki|markdown|ulw-loop)(\/|$)/.test(normalized)) return { path: relativePath, layer: "domain", reason: "Tiny-Chu domain module path" };
  if (/(\bui\b|\bcomponents?\b|\bpages?\b|\bviews?\b|button|\.tsx$)/.test(normalized) || /<button|onclick|onClick/.test(content)) return { path: relativePath, layer: "ui", reason: "UI path, TSX, or button handler" };
  if (/(\bapi\b|\bcontrollers?\b|\broutes?\b|endpoint|handler)/.test(normalized) || /\b(app|router)\.(get|post|put|patch|delete)\b/.test(content)) return { path: relativePath, layer: "api", reason: "route/controller path or HTTP handler" };
  if (/(^|\/)(db|database|repositories?|models?|schema|migrations?)(\/|[-_.])|\.sql$|\.prisma$/.test(normalized) || /\b(INSERT|SELECT|UPDATE|DELETE)\b|sql`/.test(content)) return { path: relativePath, layer: "database", reason: "database path, schema, or SQL" };
  return { path: relativePath, layer: "domain", reason: "source file outside UI/API/database patterns" };
}

function layerSummary(files: readonly RepoMapFile[]): readonly RepoMapLayer[] {
  return LAYER_ORDER.flatMap((name) => {
    const matches = files.filter((file) => file.layer === name);
    if (matches.length === 0) return [];
    return [{ name, files: matches.map((file) => file.path), evidence: matches.slice(0, 5).map((file) => `${file.path}: ${file.reason}`) }];
  });
}

function flowHints(layers: readonly RepoMapLayer[]): readonly RepoDataFlowHint[] {
  const names = new Set(layers.map((layer) => layer.name));
  const hints: RepoDataFlowHint[] = [];
  if (names.has("ui") && names.has("api")) hints.push({ from: "ui", to: "api", evidence: ["UI event handlers should be traced to route/controller files."] });
  if (names.has("api") && names.has("domain")) hints.push({ from: "api", to: "domain", evidence: ["API handlers may call domain services."] });
  if ((names.has("api") || names.has("domain")) && names.has("database")) hints.push({ from: names.has("domain") ? "domain" : "api", to: "database", evidence: ["Write/read paths should be traced to repository, schema, SQL, or model files."] });
  return hints;
}

export async function createRepoMap(root: string, input: Record<string, unknown>): Promise<RepoMapResult> {
  const scanRoot = await resolveExistingPathInsideRoot(root, targetPath(input.targetPath));
  if (!scanRoot) throw new Error("Repo map target path is outside configured root");
  const isFileTarget = path.extname(scanRoot) !== "";
  const start = isFileTarget ? path.dirname(scanRoot) : scanRoot;
  const configuredRoot = await resolveExistingPathInsideRoot(root, ".");
  const base = configuredRoot ?? root;
  const limit = positiveInteger(input.maxFiles, 120);
  const relativeFiles: string[] = isFileTarget && INCLUDED_EXTENSIONS.has(path.extname(scanRoot)) ? [portableRelative(base, scanRoot)] : [];
  if (!isFileTarget) await collectFiles(base, start, limit, relativeFiles);
  const files: RepoMapFile[] = [];
  for (const relative of relativeFiles) {
    const absolute = await resolveExistingPathInsideRoot(base, relative);
    if (!absolute) continue;
    const content = (await readFile(absolute, "utf8")).slice(0, 4000);
    files.push(classify(relative, content));
  }
  const layers = layerSummary(files);
  return {
    root: portableRelative(base, start) || ".",
    scannedFiles: relativeFiles.length,
    files,
    layers,
    dataFlowHints: flowHints(layers),
    recommendedCommands: [
      "fd --type f --hidden --exclude .git --exclude node_modules --exclude dist",
      "rg --json --line-number --column --no-heading '<route|handler|button|sql term>' <mapped files>",
      "ast-grep run --lang ts -p '<handler or call pattern>' <mapped files>",
      "context_digest targetPath=<file> query=<symbol>",
    ],
  };
}
