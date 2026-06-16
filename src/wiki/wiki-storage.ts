import { lstat, mkdir, realpath } from "node:fs/promises";
import { isPathInsideRoot } from "../state/path-safety.js";
import { resolveTinyChuPaths } from "../state/paths.js";

type WikiIndexPath = {
  readonly file: string;
  readonly exists: boolean;
};

type FileStat = Awaited<ReturnType<typeof lstat>>;

export class WikiStoragePathError extends Error {
  readonly name = "WikiStoragePathError";

  constructor(message: string) {
    super(message);
  }
}

export async function resolveWikiIndexReadPath(root?: string): Promise<WikiIndexPath> {
  const paths = resolveTinyChuPaths(root);
  const rootReal = await realpath(paths.root);
  if (!await safeExistingDirectory(paths.root, rootReal, paths.tinyDir)) return { file: paths.wikiIndexFile, exists: false };
  if (!await safeExistingDirectory(paths.root, rootReal, paths.wikiDir)) return { file: paths.wikiIndexFile, exists: false };
  return { file: paths.wikiIndexFile, exists: await safeExistingFile(paths.root, rootReal, paths.wikiIndexFile) };
}

export async function resolveWikiIndexWritePath(root?: string): Promise<string> {
  const paths = resolveTinyChuPaths(root);
  const rootReal = await realpath(paths.root);
  await ensureSafeDirectory(paths.root, rootReal, paths.tinyDir);
  await ensureSafeDirectory(paths.root, rootReal, paths.wikiDir);
  await safeExistingFile(paths.root, rootReal, paths.wikiIndexFile);
  return paths.wikiIndexFile;
}

async function ensureSafeDirectory(lexicalRoot: string, rootReal: string, dir: string): Promise<void> {
  if (!isPathInsideRoot(lexicalRoot, dir)) throw new WikiStoragePathError(`Wiki storage directory is outside root: ${dir}`);
  const before = await optionalLstat(dir);
  if (!before) await mkdir(dir, { recursive: true });
  await assertDirectorySafe(rootReal, dir, await lstat(dir));
}

async function safeExistingDirectory(lexicalRoot: string, rootReal: string, dir: string): Promise<boolean> {
  if (!isPathInsideRoot(lexicalRoot, dir)) throw new WikiStoragePathError(`Wiki storage directory is outside root: ${dir}`);
  const stat = await optionalLstat(dir);
  if (!stat) return false;
  await assertDirectorySafe(rootReal, dir, stat);
  return true;
}

async function safeExistingFile(lexicalRoot: string, rootReal: string, file: string): Promise<boolean> {
  if (!isPathInsideRoot(lexicalRoot, file)) throw new WikiStoragePathError(`Wiki index file is outside root: ${file}`);
  const stat = await optionalLstat(file);
  if (!stat) return false;
  if (stat.isSymbolicLink()) throw new WikiStoragePathError(`Wiki index file cannot be a symlink: ${file}`);
  if (!stat.isFile()) throw new WikiStoragePathError(`Wiki index path is not a file: ${file}`);
  const fileReal = await realpath(file);
  if (!isPathInsideRoot(rootReal, fileReal)) throw new WikiStoragePathError(`Wiki index file escapes root: ${file}`);
  return true;
}

async function assertDirectorySafe(rootReal: string, dir: string, stat: FileStat): Promise<void> {
  if (stat.isSymbolicLink()) throw new WikiStoragePathError(`Wiki storage directory cannot be a symlink: ${dir}`);
  if (!stat.isDirectory()) throw new WikiStoragePathError(`Wiki storage path is not a directory: ${dir}`);
  const dirReal = await realpath(dir);
  if (!isPathInsideRoot(rootReal, dirReal)) throw new WikiStoragePathError(`Wiki storage directory escapes root: ${dir}`);
}

async function optionalLstat(target: string): Promise<FileStat | undefined> {
  try {
    return await lstat(target);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}
