import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveExistingPathInsideRoot } from "../state/path-safety.js";

export interface BusinessComparison {
  readonly left: string;
  readonly operator: string;
  readonly right: string;
  readonly line: number;
}

export interface BusinessLogicFile {
  readonly path: string;
  readonly variables: readonly string[];
  readonly columns: readonly string[];
  readonly comparisons: readonly BusinessComparison[];
  readonly evidence: readonly string[];
}

export interface BusinessLogicMapResult {
  readonly root: string;
  readonly scannedFiles: number;
  readonly files: readonly BusinessLogicFile[];
  readonly recommendedCommands: readonly string[];
}

const EXCLUDED_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".tiny", ".omo"]);
const INCLUDED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".sql", ".prisma"]);
const RELATIONAL_COMPARISON = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*(===|!==|==|!=|>=|<=|>|<)\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?|\$?\d+(?:\.\d+)?|"[^"]*"|'[^']*')/g;
const EQUALITY_COMPARISON = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*=\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?|\$?\d+(?:\.\d+)?|"[^"]*"|'[^']*')/g;
const MEMBER_ACCESS = /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\b/g;
const SNAKE_COLUMN = /\b[a-z][a-z0-9]*_[a-z0-9_]*\b/g;

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function targetPath(value: unknown): string {
  return typeof value === "string" && value.trim() !== "" ? value : ".";
}

function unique(values: readonly string[], limit: number): readonly string[] {
  return [...new Set(values)].sort().slice(0, limit);
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
    if (entry.isFile() && INCLUDED_EXTENSIONS.has(path.extname(entry.name))) {
      acc.push(path.relative(root, absolute));
    }
  }
}

function comparisonsFromLine(line: string, lineNumber: number, limit: number): BusinessComparison[] {
  const comparisons: BusinessComparison[] = [];
  for (const match of line.matchAll(RELATIONAL_COMPARISON)) {
    const left = match[1];
    const operator = match[2];
    const right = match[3];
    if (!left || !operator || !right) continue;
    if ((operator === "<" || operator === ">") && /^[a-z][\w-]*$/i.test(right) && /<[A-Za-z][\w-]*/.test(line)) continue;
    if ((operator === "<" || operator === ">") && line.includes(`${left}${operator}${right}`)) continue;
    comparisons.push({ left, operator, right, line: lineNumber });
    if (comparisons.length >= limit) break;
  }
  for (const match of line.matchAll(EQUALITY_COMPARISON)) {
    const left = match[1];
    const right = match[2];
    if (!left || !right || right === "new" || (!/_/.test(`${left}${right}`) && !/^(?:\$?\d|["'])/.test(right))) continue;
    comparisons.push({ left, operator: "=", right, line: lineNumber });
    if (comparisons.length >= limit) break;
  }
  return comparisons;
}

function analyzeFile(relativePath: string, content: string, maxItems: number): BusinessLogicFile {
  const lines = content.split(/\r?\n/);
  const variables: string[] = [];
  const columns: string[] = [];
  const comparisons: BusinessComparison[] = [];
  for (const [index, line] of lines.entries()) {
    variables.push(...Array.from(line.matchAll(MEMBER_ACCESS), (match) => match[0]));
    columns.push(...Array.from(line.matchAll(SNAKE_COLUMN), (match) => match[0]));
    if (comparisons.length < maxItems) {
      comparisons.push(...comparisonsFromLine(line, index + 1, maxItems - comparisons.length));
    }
  }
  return {
    path: relativePath,
    variables: unique(variables, maxItems),
    columns: unique(columns, maxItems),
    comparisons: comparisons.slice(0, maxItems),
    evidence: comparisons.slice(0, maxItems).map((comparison) => `${relativePath}:${comparison.line} ${comparison.left} ${comparison.operator} ${comparison.right}`),
  };
}

export async function createBusinessLogicMap(root: string, input: Record<string, unknown>): Promise<BusinessLogicMapResult> {
  const scanRoot = await resolveExistingPathInsideRoot(root, targetPath(input.targetPath));
  if (!scanRoot) throw new Error("Business logic target path is outside configured root");
  const base = await resolveExistingPathInsideRoot(root, ".");
  const configuredRoot = base ?? root;
  const isFileTarget = path.extname(scanRoot) !== "";
  const start = isFileTarget ? path.dirname(scanRoot) : scanRoot;
  const maxFiles = positiveInteger(input.maxFiles, 80);
  const maxItems = positiveInteger(input.maxItemsPerFile, 12);
  const relativeFiles: string[] = isFileTarget && INCLUDED_EXTENSIONS.has(path.extname(scanRoot)) ? [path.relative(configuredRoot, scanRoot)] : [];
  if (!isFileTarget) await collectFiles(configuredRoot, start, maxFiles, relativeFiles);
  const files: BusinessLogicFile[] = [];
  for (const relative of relativeFiles) {
    const absolute = await resolveExistingPathInsideRoot(configuredRoot, relative);
    if (!absolute) continue;
    const file = analyzeFile(relative, (await readFile(absolute, "utf8")).slice(0, 12000), maxItems);
    if (file.variables.length > 0 || file.columns.length > 0 || file.comparisons.length > 0) files.push(file);
  }
  return {
    root: path.relative(configuredRoot, start) || ".",
    scannedFiles: relativeFiles.length,
    files,
    recommendedCommands: [
      "rg --json --line-number --column '(>=|<=|===|!==|==|!=|>|<)' <business files>",
      "ast-grep run --lang ts -p '$LEFT >= $RIGHT' src",
      "rg --json --line-number --column '\\b[a-z][a-z0-9]*_[a-z0-9_]*\\b' <db files>",
      "context_digest targetPath=<file> query=<variable-or-column>",
    ],
  };
}
