import { lstatSync } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { resolveExistingPathInsideRoot, resolvePathInsideRoot } from "../state/path-safety.js";

const REPORT_DIR = ".tiny/reports/git-weekly";

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

function isSafeRelative(relative: string): boolean {
  return relative === "" || !(relative === ".." || relative.startsWith("../") || relative.startsWith("..\\"));
}

async function rejectUnsafeExisting(root: string, relative: string, label: string): Promise<void> {
  const absolute = resolvePathInsideRoot(root, relative);
  if (!absolute) throw new Error(`${label} is outside configured root`);
  const stats = lstatOptional(absolute);
  if (!stats) return;
  if (stats.isSymbolicLink()) throw new Error(`${label} symlink is outside configured root`);
  const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(absolute)]);
  if (!isSafeRelative(path.relative(realRoot, realCandidate))) throw new Error(`${label} is outside configured root`);
}

async function ensureSafeDirectory(root: string, relative: string, label: string): Promise<string> {
  const absolute = resolvePathInsideRoot(root, relative);
  if (!absolute) throw new Error(`${label} is outside configured root`);
  await rejectUnsafeExisting(root, relative, label);
  const stats = lstatOptional(absolute);
  if (!stats) await mkdir(absolute, { recursive: true });
  else if (!stats.isDirectory()) throw new Error(`${label} is not a directory`);
  if (!await resolveExistingPathInsideRoot(root, relative).catch(() => undefined)) throw new Error(`${label} is outside configured root`);
  return absolute;
}

export function relativeReportPath(...parts: readonly string[]): string {
  return [REPORT_DIR, ...parts].join("/");
}

function relativeDirname(relative: string): string {
  const index = relative.lastIndexOf("/");
  return index === -1 ? "." : relative.slice(0, index);
}

export async function assertReportStorageInsideRoot(root: string): Promise<void> {
  await rejectUnsafeExisting(root, ".tiny", "Git weekly report .tiny storage");
  await rejectUnsafeExisting(root, ".tiny/reports", "Git weekly report storage");
  await rejectUnsafeExisting(root, REPORT_DIR, "Git weekly report storage");
}

export async function safeReportPath(root: string, ...parts: readonly string[]): Promise<string> {
  await ensureSafeDirectory(root, ".tiny", "Git weekly report .tiny storage");
  await ensureSafeDirectory(root, ".tiny/reports", "Git weekly report storage");
  await ensureSafeDirectory(root, REPORT_DIR, "Git weekly report storage");
  const relative = relativeReportPath(...parts);
  const absolute = resolvePathInsideRoot(root, relative);
  if (!absolute) throw new Error(`Git weekly report path is outside configured root: ${relative}`);
  const parentRelative = relativeDirname(relative);
  await ensureSafeDirectory(root, parentRelative, "Git weekly report target directory");
  const stats = lstatOptional(absolute);
  if (stats?.isSymbolicLink()) throw new Error("Git weekly report target symlink is outside configured root");
  return absolute;
}
