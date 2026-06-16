import { createHash } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { appendJsonLine, readJsonLines } from "../state/file-store.js";
import { resolveTinyChuPaths } from "../state/paths.js";
import { isPathInsideRoot } from "../state/path-safety.js";

export type WikiErrorBookKind =
  | "dangling_link"
  | "unsupported_claim"
  | "duplicate_page"
  | "contradiction"
  | "stale_source_hash"
  | "prompt_injection_risk";

export type WikiErrorBookStatus = "open" | "ignored" | "resolved";

export interface WikiErrorBookInput {
  readonly createdAt?: string;
  readonly kind: WikiErrorBookKind;
  readonly status?: WikiErrorBookStatus;
  readonly documentId?: string;
  readonly sourcePath?: string;
  readonly evidenceRefs: readonly string[];
  readonly summary: string;
}

export interface WikiErrorBookRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly kind: WikiErrorBookKind;
  readonly status: WikiErrorBookStatus;
  readonly documentId?: string;
  readonly sourcePath?: string;
  readonly evidenceRefs: readonly string[];
  readonly summary: string;
}

class WikiErrorBookInputError extends Error {
  readonly name = "WikiErrorBookInputError";

  constructor(readonly field: string) {
    super(`Invalid wiki error book field: ${field}`);
  }
}

class WikiErrorBookStorageError extends Error {
  readonly name = "WikiErrorBookStorageError";

  constructor(message: string) {
    super(message);
  }
}

function errorBookFile(root: string): string {
  return path.join(resolveTinyChuPaths(root).wikiDir, "error-book.jsonl");
}

function normalizedText(field: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") throw new WikiErrorBookInputError(field);
  return trimmed;
}

function optionalNormalizedText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}

function normalizedRefs(values: readonly string[], field: string): readonly string[] {
  const refs = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed !== "") refs.add(trimmed);
  }
  if (refs.size === 0) throw new WikiErrorBookInputError(field);
  return [...refs].sort((left, right) => left.localeCompare(right));
}

function hashRecord(record: Omit<WikiErrorBookRecord, "id" | "createdAt">): string {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}

export function createWikiErrorBookRecord(input: WikiErrorBookInput): WikiErrorBookRecord {
  const recordContent = {
    kind: input.kind,
    status: input.status ?? "open",
    documentId: optionalNormalizedText(input.documentId),
    sourcePath: optionalNormalizedText(input.sourcePath),
    evidenceRefs: normalizedRefs(input.evidenceRefs, "evidenceRefs"),
    summary: normalizedText("summary", input.summary),
  };
  const hash = hashRecord(recordContent);
  return {
    id: `wiki-error-${hash.slice(0, 16)}`,
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...recordContent,
  };
}

export async function appendWikiErrorBookRecord(root: string, input: WikiErrorBookInput): Promise<WikiErrorBookRecord> {
  const record = createWikiErrorBookRecord(input);
  await assertErrorBookPathSafe(root);
  await appendJsonLine(errorBookFile(root), record);
  return record;
}

export async function readWikiErrorBookRecords(root: string): Promise<readonly WikiErrorBookRecord[]> {
  await assertErrorBookPathSafe(root);
  return readJsonLines<WikiErrorBookRecord>(errorBookFile(root), []);
}

async function assertErrorBookPathSafe(root: string): Promise<void> {
  const paths = resolveTinyChuPaths(root);
  const lexicalRoot = paths.root;
  const rootReal = await realpath(paths.root);
  await assertDirectorySafe(lexicalRoot, rootReal, paths.tinyDir);
  await assertDirectorySafe(lexicalRoot, rootReal, paths.wikiDir);
  await assertFileSafe(lexicalRoot, rootReal, errorBookFile(root));
}

async function assertDirectorySafe(lexicalRoot: string, rootReal: string, dir: string): Promise<void> {
  if (!isPathInsideRoot(lexicalRoot, dir)) throw new WikiErrorBookStorageError(`Wiki error book path is outside root: ${dir}`);
  await mkdir(dir, { recursive: true });
  const stat = await lstat(dir);
  if (stat.isSymbolicLink()) throw new WikiErrorBookStorageError(`Wiki error book directory cannot be a symlink: ${dir}`);
  if (!stat.isDirectory()) throw new WikiErrorBookStorageError(`Wiki error book path is not a directory: ${dir}`);
  const dirReal = await realpath(dir);
  if (!isPathInsideRoot(rootReal, dirReal)) throw new WikiErrorBookStorageError(`Wiki error book directory escapes root: ${dir}`);
}

async function assertFileSafe(lexicalRoot: string, rootReal: string, file: string): Promise<void> {
  if (!isPathInsideRoot(lexicalRoot, file)) throw new WikiErrorBookStorageError(`Wiki error book file is outside root: ${file}`);
  try {
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) throw new WikiErrorBookStorageError(`Wiki error book file cannot be a symlink: ${file}`);
    if (!stat.isFile()) throw new WikiErrorBookStorageError(`Wiki error book path is not a file: ${file}`);
    const fileReal = await realpath(file);
    if (!isPathInsideRoot(rootReal, fileReal)) throw new WikiErrorBookStorageError(`Wiki error book file escapes root: ${file}`);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}
