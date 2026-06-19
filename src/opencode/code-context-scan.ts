import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveExistingPathInsideRoot } from "../state/path-safety.js";
import type {
  CodeContextEvidenceKind,
  CodeContextFinding,
  CodeContextItem,
  CodeContextReason,
  CodeContextScanResult,
  CodeContextSourcePrefix,
  CodeContextTagKind,
} from "./code-context-scan-types.js";

export type {
  CodeContextEvidenceKind,
  CodeContextFinding,
  CodeContextFindingCode,
  CodeContextItem,
  CodeContextReason,
  CodeContextScanResult,
  CodeContextSourcePrefix,
  CodeContextTagKind,
} from "./code-context-scan-types.js";

const EVIDENCE_KIND: CodeContextEvidenceKind = "navigation_hint";
const DEFAULT_PREFIXES = new Set<CodeContextSourcePrefix>(["TC", "MX"]);
const TAG_KINDS = new Set<string>(["NOTE", "WARN", "ANCHOR", "TODO", "REASON"]);
const INCLUDED_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".md",
  ".mjs",
  ".py",
  ".rs",
  ".sql",
  ".swift",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
const EXCLUDED_DIRS = new Set([".git", ".tiny", ".omo", ".analysis", "dist", "node_modules"]);
const TAG_PATTERN = /(?:^|\s)@(TC|MX):([A-Z]+)\b:?\s*(.*)$/u;
const INLINE_REASON_PATTERN = /(?:^|\s)REASON:\s*(.+)$/u;

interface SourceFile {
  readonly path: string;
  readonly absolutePath: string;
}

interface FileCollectionState {
  readonly root: string;
  readonly limit: number;
  readonly files: SourceFile[];
  readonly skippedPaths: string[];
  readonly visitedDirs: Set<string>;
}

interface ParsedTag {
  readonly path: string;
  readonly line: number;
  readonly sourcePrefix: CodeContextSourcePrefix;
  readonly kind: CodeContextTagKind;
  readonly text: string;
  readonly inlineReason?: string;
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function targetPath(value: unknown): string {
  return typeof value === "string" && value.trim() !== "" ? value : ".";
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  return normalized === "" ? "." : normalized;
}

function normalizePrefix(value: unknown): CodeContextSourcePrefix | undefined {
  if (value === "TC" || value === "@TC") return "TC";
  if (value === "MX" || value === "@MX") return "MX";
  return undefined;
}

function prefixesInput(value: unknown): ReadonlySet<CodeContextSourcePrefix> {
  if (!Array.isArray(value)) return DEFAULT_PREFIXES;
  const prefixes = new Set<CodeContextSourcePrefix>();
  for (const item of value) {
    const prefix = normalizePrefix(item);
    if (prefix) prefixes.add(prefix);
  }
  return prefixes.size > 0 ? prefixes : DEFAULT_PREFIXES;
}

function isIncludedFile(filePath: string): boolean {
  return INCLUDED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function byLocation(left: { readonly path: string; readonly line: number }, right: { readonly path: string; readonly line: number }): number {
  const pathOrder = left.path.localeCompare(right.path);
  return pathOrder === 0 ? left.line - right.line : pathOrder;
}

async function collectFiles(relativePath: string, state: FileCollectionState): Promise<void> {
  if (state.files.length >= state.limit) return;
  const relative = normalizeRelativePath(relativePath);
  const name = path.basename(relative);
  if (EXCLUDED_DIRS.has(name)) {
    state.skippedPaths.push(relative);
    return;
  }
  const resolved = await resolveExistingPathInsideRoot(state.root, relative);
  if (!resolved) {
    state.skippedPaths.push(relative);
    return;
  }
  const stats = await lstat(resolved);
  if (stats.isDirectory()) {
    if (state.visitedDirs.has(resolved)) return;
    state.visitedDirs.add(resolved);
    const entries = await readdir(resolved, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (state.files.length >= state.limit) return;
      await collectFiles(normalizeRelativePath(path.join(relative, entry.name)), state);
    }
    return;
  }
  if (!stats.isFile()) {
    state.skippedPaths.push(relative);
    return;
  }
  if (!isIncludedFile(relative)) {
    state.skippedPaths.push(relative);
    return;
  }
  state.files.push({ path: relative, absolutePath: resolved });
}

function tagKind(value: string): CodeContextTagKind | undefined {
  if (!TAG_KINDS.has(value)) return undefined;
  switch (value) {
    case "NOTE":
    case "WARN":
    case "ANCHOR":
    case "TODO":
    case "REASON":
      return value;
    default:
      return undefined;
  }
}

function parseLine(source: SourceFile, line: string, lineNumber: number, prefixes: ReadonlySet<CodeContextSourcePrefix>): ParsedTag | CodeContextFinding | undefined {
  const match = line.match(TAG_PATTERN);
  if (!match) return undefined;
  const sourcePrefix = normalizePrefix(match[1]);
  if (!sourcePrefix || !prefixes.has(sourcePrefix)) return undefined;
  const rawKind = match[2] ?? "";
  const kind = tagKind(rawKind);
  if (!kind) {
    return {
      code: "unknown_tag",
      path: source.path,
      line: lineNumber,
      message: `Unknown code context tag ${rawKind}.`,
      evidenceKind: EVIDENCE_KIND,
    };
  }
  const rawText = (match[3] ?? "").trim();
  const inlineReason = rawText.match(INLINE_REASON_PATTERN)?.[1]?.trim();
  return {
    path: source.path,
    line: lineNumber,
    sourcePrefix,
    kind,
    text: rawText,
    inlineReason: inlineReason && inlineReason !== "" ? inlineReason : undefined,
  };
}

function reasonFor(item: ParsedTag, parsed: readonly ParsedTag[]): CodeContextReason | undefined {
  if (item.inlineReason) return { path: item.path, line: item.line, text: item.inlineReason };
  const reason = parsed.find((candidate) => candidate.path === item.path && candidate.kind === "REASON" && candidate.line > item.line && candidate.line <= item.line + 3);
  return reason ? { path: reason.path, line: reason.line, text: reason.text } : undefined;
}

function toItem(item: ParsedTag, parsed: readonly ParsedTag[]): CodeContextItem {
  const reason = item.kind === "WARN" || item.kind === "ANCHOR" ? reasonFor(item, parsed) : undefined;
  return {
    path: item.path,
    line: item.line,
    prefix: "TC",
    sourcePrefix: item.sourcePrefix,
    kind: item.kind,
    text: item.text,
    evidenceKind: EVIDENCE_KIND,
    reason,
  };
}

function reasonFindings(items: readonly CodeContextItem[]): readonly CodeContextFinding[] {
  return items.flatMap((item) => {
    if ((item.kind === "WARN" || item.kind === "ANCHOR") && !item.reason) {
      return [{
        code: "missing_reason",
        path: item.path,
        line: item.line,
        message: `${item.kind} annotations require a nearby @TC:REASON or @MX:REASON.`,
        evidenceKind: EVIDENCE_KIND,
      }];
    }
    return [];
  });
}

export async function createCodeContextScan(root: string, input: Record<string, unknown>): Promise<CodeContextScanResult> {
  const configuredRoot = await resolveExistingPathInsideRoot(root, ".");
  const base = configuredRoot ?? root;
  const scanRoot = await resolveExistingPathInsideRoot(base, targetPath(input.targetPath));
  if (!scanRoot) throw new Error("Code context scan target path is outside configured root or missing");

  const relativeRoot = normalizeRelativePath(path.relative(base, scanRoot));
  const files: SourceFile[] = [];
  const skippedPaths: string[] = [];
  await collectFiles(relativeRoot, {
    root: base,
    limit: positiveInteger(input.maxFiles, 250),
    files,
    skippedPaths,
    visitedDirs: new Set<string>(),
  });

  const prefixes = prefixesInput(input.prefixes);
  const parsed: ParsedTag[] = [];
  const findings: CodeContextFinding[] = [];
  for (const source of files.sort((left, right) => left.path.localeCompare(right.path))) {
    const lines = (await readFile(source.absolutePath, "utf8")).split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      const item = parseLine(source, line, index + 1, prefixes);
      if (!item) continue;
      if ("code" in item) findings.push(item);
      else parsed.push(item);
    }
  }

  const items = parsed.sort(byLocation).map((item) => toItem(item, parsed));
  return {
    evidenceKind: EVIDENCE_KIND,
    root: relativeRoot,
    items,
    findings: [...findings, ...reasonFindings(items)].sort(byLocation),
    scannedFiles: files.length,
    skippedPaths: uniqueSorted(skippedPaths),
  };
}
