import { lstatSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { resolveExistingPathInsideRoot, resolvePathInsideRoot } from "../state/path-safety.js";

export function truthJsonPath(root: string, candidate?: unknown): string {
  const relative = typeof candidate === "string" && candidate.trim() !== "" ? candidate : ".tiny/ux/layout-truth.json";
  const resolved = resolvePathInsideRoot(root, relative);
  if (!resolved) throw new Error(`Layout truth path is outside configured root: ${relative}`);
  const uxRoot = resolvePathInsideRoot(root, ".tiny/ux");
  if (!uxRoot) throw new Error("Layout truth root is outside configured root");
  const fromUx = path.relative(uxRoot, resolved);
  if (!isSafeRelative(fromUx)) throw new Error(`Layout truth path is outside .tiny/ux: ${relative}`);
  return resolved;
}

export function relativeToRoot(root: string, absolute: string): string {
  return path.relative(root, absolute).replace(/\\/g, "/");
}

export function layoutTruthMarkdownPath(root: string): string {
  const markdownPath = resolvePathInsideRoot(root, ".tiny/ux/layout-truth.md");
  if (!markdownPath) throw new Error("Layout truth report path is outside configured root");
  return markdownPath;
}

function isSafeRelative(relative: string): boolean {
  return relative === "" || !(relative === ".." || relative.startsWith("../") || relative.startsWith("..\\"));
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function lstatOptional(candidate: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(candidate);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

function rejectSymlink(candidate: string, message: string): void {
  const stats = lstatOptional(candidate);
  if (stats?.isSymbolicLink()) throw new Error(message);
}

async function existingInsideRoot(root: string, candidate: string): Promise<boolean> {
  return (await resolveExistingPathInsideRoot(root, candidate).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  })) !== undefined;
}

async function requireExistingInsideRoot(root: string, candidate: string, message: string): Promise<void> {
  if (!await existingInsideRoot(root, candidate)) throw new Error(message);
}

async function ensureSafeDirectoryPath(root: string, base: string, targetDir: string): Promise<void> {
  const relative = path.relative(base, targetDir);
  if (!isSafeRelative(relative)) throw new Error(`Layout truth target directory is outside configured root: ${relativeToRoot(root, targetDir)}`);
  let current = base;
  for (const part of relative.split(/[\\/]+/).filter((value) => value !== "")) {
    current = path.join(current, part);
    const stats = lstatOptional(current);
    if (stats?.isSymbolicLink()) throw new Error("Layout truth target directory symlink is outside configured root");
    if (stats) {
      if (!stats.isDirectory()) throw new Error("Layout truth target path is not a directory");
      await requireExistingInsideRoot(root, current, "Layout truth target directory is outside configured root");
      continue;
    }
    await mkdir(current);
    await requireExistingInsideRoot(root, current, "Layout truth target directory is outside configured root");
  }
}

export async function ensureSafeUxTarget(root: string, target: string): Promise<void> {
  const tinyRoot = resolvePathInsideRoot(root, ".tiny");
  const uxRoot = resolvePathInsideRoot(root, ".tiny/ux");
  if (!tinyRoot || !uxRoot) throw new Error("Layout truth root is outside configured root");
  rejectSymlink(tinyRoot, "Layout truth .tiny symlink is outside configured root");
  rejectSymlink(uxRoot, "Layout truth root symlink is outside configured root");
  await mkdir(uxRoot, { recursive: true });
  await requireExistingInsideRoot(root, uxRoot, "Layout truth root is outside configured root");
  const relative = path.relative(uxRoot, target);
  if (!isSafeRelative(relative)) throw new Error(`Layout truth path is outside .tiny/ux: ${relativeToRoot(root, target)}`);
  const parent = path.dirname(target);
  await ensureSafeDirectoryPath(root, uxRoot, parent);
  await requireExistingInsideRoot(root, parent, "Layout truth target directory is outside configured root");
  rejectSymlink(target, "Layout truth target symlink is outside configured root");
  if (lstatOptional(target)) await requireExistingInsideRoot(root, target, "Layout truth target is outside configured root");
}
