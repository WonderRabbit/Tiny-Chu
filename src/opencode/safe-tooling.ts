import { createHash, randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureDir, removeIfExists } from "../state/file-store.js";
import { resolvePathInsideRoot } from "../state/path-safety.js";

export const SAFE_TOOLING_LIMITS = {
  maxPatchBytes: 262_144,
  maxTouchedFiles: 20,
  maxGeneratedFileBytes: 1_048_576,
  maxPreviewChars: 32_768,
  gitApplyCheckTimeoutMs: 5_000,
  nativeTimeoutMs: 10_000,
  diagnosticsCommandTimeoutMs: 120_000,
} as const;

export type SourceTargetStatus = "present" | "missing" | "symlink";

export interface SourceTargetHash {
  readonly path: string;
  readonly status: SourceTargetStatus;
  readonly hash: string;
}

export interface SafeToolingDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface SafeToolingLock {
  readonly path: string;
  readonly acquired: true;
  readonly release: () => Promise<void>;
}

const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/;

export function boundedText(text: string, maxChars: number = SAFE_TOOLING_LIMITS.maxPreviewChars): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}

export function normalizeSafeRelativePath(candidate: string): string | undefined {
  if (candidate.trim() === "" || path.isAbsolute(candidate) || WINDOWS_ABSOLUTE.test(candidate)) return undefined;
  const normalized = candidate.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (normalized === "" || normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) return undefined;
  return normalized;
}

export function targetMatchesPattern(target: string, pattern: string): boolean {
  const normalizedPattern = normalizeSafeRelativePath(pattern);
  if (!normalizedPattern) return false;
  if (normalizedPattern === target) return true;
  if (normalizedPattern === "*") return !target.includes("/");
  if (normalizedPattern.endsWith("/**")) return target.startsWith(normalizedPattern.slice(0, -2));
  if (normalizedPattern.startsWith("*.")) return !target.includes("/") && target.endsWith(normalizedPattern.slice(1));
  return false;
}

export function isTargetAllowed(target: string, allowedTargets: readonly string[]): boolean {
  return allowedTargets.some((pattern) => targetMatchesPattern(target, pattern));
}

export async function ensureWritableTarget(root: string, target: string, allowMissing: boolean): Promise<SafeToolingDiagnostic | undefined> {
  const normalized = normalizeSafeRelativePath(target);
  if (!normalized) return { code: "unsafe_path", message: "Target path must be root-relative and must not traverse.", path: target };
  const resolved = resolvePathInsideRoot(root, normalized);
  if (!resolved) return { code: "outside_root", message: "Target path escapes root.", path: target };
  try {
    const info = await lstat(resolved);
    if (info.isSymbolicLink()) return { code: "symlink_target", message: "Source writes refuse symlink targets.", path: target };
    const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(resolved)]);
    const relative = path.relative(realRoot, realTarget);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return { code: "realpath_escape", message: "Target realpath escapes root.", path: target };
    return undefined;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    if (!allowMissing) return { code: "missing_target", message: "Target file is missing.", path: target };
    const parent = path.dirname(resolved);
    const [realRoot, realParent] = await Promise.all([realpath(root), realpath(parent)]);
    const relative = path.relative(realRoot, realParent);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)) ? undefined : { code: "parent_escape", message: "New target parent escapes root.", path: target };
  }
}

export async function isPreparedArtifactWorkspace(sourceRoot: string, workspaceRoot: string): Promise<boolean> {
  const [realSource, realWorkspace] = await Promise.all([realpath(sourceRoot), realpath(workspaceRoot)]);
  const sourceRelative = path.relative(realSource, realWorkspace);
  if (sourceRelative === "" || (!sourceRelative.startsWith("..") && !path.isAbsolute(sourceRelative))) return false;
  try {
    const marker = JSON.parse(await readFile(path.join(realWorkspace, ".tiny-chu-workspace.json"), "utf8"));
    return typeof marker === "object" && marker !== null && typeof marker.workspaceId === "string";
  } catch (error) {
    return false;
  }
}

export async function isPathUnderDirectory(parent: string, candidate: string): Promise<boolean> {
  const [realParent, realCandidate] = await Promise.all([realpath(parent), realpath(candidate)]);
  const relative = path.relative(realParent, realCandidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function hashSourceTarget(root: string, target: string): Promise<SourceTargetHash> {
  const normalized = normalizeSafeRelativePath(target) ?? target;
  const resolved = resolvePathInsideRoot(root, normalized);
  if (!resolved) return { path: target, status: "missing", hash: "missing" };
  try {
    const info = await lstat(resolved);
    if (info.isSymbolicLink()) return { path: normalized, status: "symlink", hash: "symlink" };
    const bytes = await readFile(resolved);
    return { path: normalized, status: "present", hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { path: normalized, status: "missing", hash: "missing" };
    throw error;
  }
}

export async function acquireSafeToolingLock(root: string): Promise<SafeToolingLock | undefined> {
  const lockPath = path.join(root, ".tiny", "locks", "safe-tooling.lock");
  try {
    await mkdir(lockPath, { recursive: false });
    await writeFile(path.join(lockPath, "owner.json"), JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), "utf8");
    return { path: lockPath, acquired: true, release: async () => { await rm(lockPath, { recursive: true, force: true }); } };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      await ensureDir(path.dirname(lockPath));
      return acquireSafeToolingLock(root);
    }
    if (error instanceof Error && "code" in error && error.code === "EEXIST") return undefined;
    throw error;
  }
}

export async function writeBytesAtomic(file: string, bytes: Buffer): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(tmp, bytes);
  await rename(tmp, file);
}

export async function copyFileEnsuringDir(source: string, target: string): Promise<void> {
  await ensureDir(path.dirname(target));
  await copyFile(source, target);
}

export async function removePathIfExists(target: string): Promise<boolean> {
  return removeIfExists(target);
}

export async function removeDirIfExists(target: string): Promise<void> {
  await rm(target, { recursive: true, force: true });
}
