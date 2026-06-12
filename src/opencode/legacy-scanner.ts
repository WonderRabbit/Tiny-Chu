import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveExistingPathInsideRoot } from "../state/path-safety.js";
import type { LegacyConfidence, LegacyEvidenceFact } from "./legacy-types.js";

const EXCLUDED_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".tiny", ".omo", ".analysis"]);
const INCLUDED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".java", ".xml", ".json", ".gradle", ".sql", ".md", ".yml", ".yaml"]);

export interface LegacySourceFile {
  readonly path: string;
  readonly content: string;
  readonly lines: readonly string[];
}

export function textInput(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

export function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

export function factId(kind: string, file: string, line: number, symbol?: string): string {
  return [kind, file, line, symbol ?? "fact"].join(":");
}

export function evidenceFact(input: {
  readonly kind: string;
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly symbol?: string;
  readonly confidence?: LegacyConfidence;
  readonly method?: string;
  readonly path?: string;
  readonly operation?: string;
  readonly tables?: readonly string[];
}): LegacyEvidenceFact {
  return {
    id: factId(input.kind, input.file, input.line, input.symbol),
    kind: input.kind,
    file: input.file,
    line: input.line,
    text: input.text.trim(),
    confidence: input.confidence ?? "verified",
    ...(input.symbol ? { symbol: input.symbol } : {}),
    ...(input.method ? { method: input.method } : {}),
    ...(input.path ? { path: input.path } : {}),
    ...(input.operation ? { operation: input.operation } : {}),
    ...(input.tables ? { tables: input.tables } : {}),
  };
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
      acc.push(path.relative(root, absolute).replace(/\\/g, "/"));
    }
  }
}

export async function readLegacySourceFiles(root: string, input: Record<string, unknown>): Promise<readonly LegacySourceFile[]> {
  const target = await resolveExistingPathInsideRoot(root, textInput(input.targetPath, "."));
  if (!target) throw new Error("Legacy analysis target path is outside configured root");
  const configuredRoot = await resolveExistingPathInsideRoot(root, ".");
  const base = configuredRoot ?? root;
  const isFileTarget = path.extname(target) !== "";
  const start = isFileTarget ? path.dirname(target) : target;
  const files = isFileTarget && INCLUDED_EXTENSIONS.has(path.extname(target))
    ? [path.relative(base, target).replace(/\\/g, "/")]
    : [];
  if (!isFileTarget) await collectFiles(base, start, positiveInteger(input.maxFiles, 160), files);
  const sources: LegacySourceFile[] = [];
  for (const relative of files) {
    const absolute = await resolveExistingPathInsideRoot(base, relative);
    if (!absolute) continue;
    const content = (await readFile(absolute, "utf8")).slice(0, positiveInteger(input.maxFileChars, 20_000));
    sources.push({ path: relative, content, lines: content.split(/\r?\n/) });
  }
  return sources;
}

export function firstMatch(value: string, pattern: RegExp): string | undefined {
  const match = value.match(pattern);
  return match?.[1];
}

export function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}
