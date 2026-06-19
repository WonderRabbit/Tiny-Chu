import { lstat, mkdir, realpath } from "node:fs/promises";
import { appendJsonLine, readJsonFile, readJsonLines, writeJsonAtomic } from "../state/file-store.js";
import { withTinyStateLock } from "../state/lock-store.js";
import { isPathInsideRoot } from "../state/path-safety.js";
import { resolveTinyChuPaths } from "../state/paths.js";
import type { NamingCandidate, NamingDiagnostic } from "./naming-check.js";
import { buildNamingIndex, type NamingIndex } from "./naming-index.js";

export type NamingProposalEvent = {
  readonly id: string;
  readonly createdAt: string;
  readonly action: "propose";
  readonly candidate: NamingCandidate;
  readonly normalized: string;
  readonly status: "pending" | "duplicate";
  readonly diagnostics: readonly NamingDiagnostic[];
};

type NamingStateFile = {
  readonly file: string;
  readonly exists: boolean;
};

type FileStat = Awaited<ReturnType<typeof lstat>>;

export class NamingStoragePathError extends Error {
  readonly name = "NamingStoragePathError";

  constructor(message: string) {
    super(message);
  }
}

export async function readNamingIndex(root?: string): Promise<NamingIndex> {
  const stateFile = await resolveNamingReadFile(root, "index");
  if (!stateFile.exists) return buildNamingIndex({ schemaVersion: 1, entries: [] });
  return readJsonFile<NamingIndex>(stateFile.file, buildNamingIndex({ schemaVersion: 1, entries: [] }));
}

export async function writeNamingIndex(root: string | undefined, index: NamingIndex): Promise<void> {
  await withTinyStateLock(root, "naming-index.lock", async (lock) => {
    await lock.assertActive();
    await writeJsonAtomic(await resolveNamingWriteFile(root, "index"), index);
  });
}

export async function appendNamingProposalEvent(root: string | undefined, event: NamingProposalEvent): Promise<void> {
  await withTinyStateLock(root, "naming-index.lock", async (lock) => {
    await lock.assertActive();
    await appendJsonLine(await resolveNamingWriteFile(root, "events"), event);
  });
}

export async function appendNamingEvent(root: string | undefined, event: NamingProposalEvent): Promise<void> {
  await appendNamingProposalEvent(root, event);
}

export async function readNamingEvents(root?: string): Promise<NamingProposalEvent[]> {
  const stateFile = await resolveNamingReadFile(root, "events");
  if (!stateFile.exists) return [];
  return readJsonLines<NamingProposalEvent>(stateFile.file, []);
}

async function resolveNamingReadFile(root: string | undefined, kind: "events" | "index"): Promise<NamingStateFile> {
  const paths = resolveTinyChuPaths(root);
  const rootReal = await realpath(paths.root);
  if (!await safeExistingDirectory(paths.root, rootReal, paths.tinyDir)) return { file: namingFile(paths, kind), exists: false };
  if (!await safeExistingDirectory(paths.root, rootReal, paths.namingDir)) return { file: namingFile(paths, kind), exists: false };
  return { file: namingFile(paths, kind), exists: await safeExistingFile(paths.root, rootReal, namingFile(paths, kind), kind) };
}

async function resolveNamingWriteFile(root: string | undefined, kind: "events" | "index"): Promise<string> {
  const paths = resolveTinyChuPaths(root);
  const rootReal = await realpath(paths.root);
  await ensureSafeDirectory(paths.root, rootReal, paths.tinyDir);
  await ensureSafeDirectory(paths.root, rootReal, paths.namingDir);
  await safeExistingFile(paths.root, rootReal, namingFile(paths, kind), kind);
  return namingFile(paths, kind);
}

function namingFile(paths: ReturnType<typeof resolveTinyChuPaths>, kind: "events" | "index"): string {
  return kind === "events" ? paths.namingEventsFile : paths.namingIndexFile;
}

async function ensureSafeDirectory(lexicalRoot: string, rootReal: string, dir: string): Promise<void> {
  if (!isPathInsideRoot(lexicalRoot, dir)) throw new NamingStoragePathError(`Naming storage directory is outside root: ${dir}`);
  const before = await optionalLstat(dir);
  if (!before) await mkdir(dir, { recursive: true });
  await assertDirectorySafe(rootReal, dir, await lstat(dir));
}

async function safeExistingDirectory(lexicalRoot: string, rootReal: string, dir: string): Promise<boolean> {
  if (!isPathInsideRoot(lexicalRoot, dir)) throw new NamingStoragePathError(`Naming storage directory is outside root: ${dir}`);
  const stat = await optionalLstat(dir);
  if (!stat) return false;
  await assertDirectorySafe(rootReal, dir, stat);
  return true;
}

async function safeExistingFile(lexicalRoot: string, rootReal: string, file: string, kind: "events" | "index"): Promise<boolean> {
  if (!isPathInsideRoot(lexicalRoot, file)) throw new NamingStoragePathError(`Naming storage file is outside root: ${file}`);
  const stat = await optionalLstat(file);
  if (!stat) return false;
  if (stat.isSymbolicLink()) throw new NamingStoragePathError(`Naming ${kind} file cannot be a symlink: ${file}`);
  if (!stat.isFile()) throw new NamingStoragePathError(`Naming ${kind} path is not a file: ${file}`);
  const fileReal = await realpath(file);
  if (!isPathInsideRoot(rootReal, fileReal)) throw new NamingStoragePathError(`Naming ${kind} file escapes root: ${file}`);
  return true;
}

async function assertDirectorySafe(rootReal: string, dir: string, stat: FileStat): Promise<void> {
  if (stat.isSymbolicLink()) throw new NamingStoragePathError(`Naming storage directory cannot be a symlink: ${dir}`);
  if (!stat.isDirectory()) throw new NamingStoragePathError(`Naming storage path is not a directory: ${dir}`);
  const dirReal = await realpath(dir);
  if (!isPathInsideRoot(rootReal, dirReal)) throw new NamingStoragePathError(`Naming storage directory escapes root: ${dir}`);
}

async function optionalLstat(target: string): Promise<FileStat | undefined> {
  try {
    return await lstat(target);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}
