import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureDir } from "../state/file-store.js";
import { resolvePathInsideRoot } from "../state/path-safety.js";
import { runNativeCommand } from "./native-runner.js";
import { acquireSafeToolingLock, boundedText, copyFileEnsuringDir, ensureWritableTarget, hashSourceTarget, isTargetAllowed, normalizeSafeRelativePath, removePathIfExists, SAFE_TOOLING_LIMITS, writeBytesAtomic, type SafeToolingDiagnostic, type SourceTargetHash } from "./safe-tooling.js";

export interface SafePatchInput {
  readonly patch: string;
  readonly allowedTargets: readonly string[];
  readonly expectedFiles: Readonly<Record<string, string>>;
  readonly maxPatchBytes?: number;
  readonly maxFiles?: number;
}

export interface SafePatchTouchedFile {
  readonly path: string;
  readonly before: SourceTargetHash;
  readonly expected: string | undefined;
}

export interface SafePatchCheckResult {
  readonly valid: boolean;
  readonly wouldMutate: false;
  readonly touchedFiles: readonly SafePatchTouchedFile[];
  readonly diagnostics: readonly SafeToolingDiagnostic[];
  readonly command?: { readonly exitCode: number | null; readonly stderr: string };
}

export interface SafePatchApplyResult {
  readonly applied: boolean;
  readonly touchedFiles: readonly (SafePatchTouchedFile & { readonly after: SourceTargetHash })[];
  readonly diagnostics: readonly SafeToolingDiagnostic[];
  readonly lock?: { readonly path: string };
}

function stripPatchPath(raw: string): string | undefined {
  if (raw === "/dev/null") return undefined;
  const pathOnly = raw.split(/\s+/)[0] ?? "";
  return normalizeSafeRelativePath(pathOnly.replace(/^[ab]\//, ""));
}

function parsePatchTargets(patch: string): readonly string[] {
  const targets = new Set<string>();
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      const parts = line.split(/\s+/);
      for (const part of parts.slice(2, 4)) {
        const target = stripPatchPath(part);
        if (target) targets.add(target);
      }
    } else if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const target = stripPatchPath(line.slice(4));
      if (target) targets.add(target);
    }
  }
  return [...targets].sort();
}

async function createPatchSandbox(root: string, targets: readonly string[]): Promise<string> {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-safe-patch-"));
  for (const target of targets) {
    const source = resolvePathInsideRoot(root, target);
    const destination = path.join(sandbox, target);
    await ensureDir(path.dirname(destination));
    if (!source) continue;
    try {
      await copyFileEnsuringDir(source, destination);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
  }
  return sandbox;
}

async function validatePatchInput(root: string, input: SafePatchInput): Promise<{ readonly diagnostics: SafeToolingDiagnostic[]; readonly targets: readonly string[]; readonly touchedFiles: readonly SafePatchTouchedFile[] }> {
  const diagnostics: SafeToolingDiagnostic[] = [];
  const maxPatchBytes = input.maxPatchBytes ?? SAFE_TOOLING_LIMITS.maxPatchBytes;
  const maxFiles = input.maxFiles ?? SAFE_TOOLING_LIMITS.maxTouchedFiles;
  if (Buffer.byteLength(input.patch, "utf8") > maxPatchBytes) diagnostics.push({ code: "patch_too_large", message: "Patch exceeds byte cap." });
  if (input.allowedTargets.length === 0) diagnostics.push({ code: "default_deny", message: "allowedTargets must be non-empty." });
  const targets = parsePatchTargets(input.patch);
  if (targets.length === 0) diagnostics.push({ code: "empty_patch", message: "Patch does not include touched paths." });
  if (targets.length > maxFiles) diagnostics.push({ code: "too_many_files", message: "Patch touches too many files." });
  const touchedFiles: SafePatchTouchedFile[] = [];
  for (const target of targets) {
    if (!isTargetAllowed(target, input.allowedTargets)) diagnostics.push({ code: "disallowed_target", message: "Target is not allowlisted.", path: target });
    const expected = input.expectedFiles[target];
    const before = await hashSourceTarget(root, target);
    const writeDiagnostic = await ensureWritableTarget(root, target, expected === "missing");
    if (writeDiagnostic) diagnostics.push(writeDiagnostic);
    if (expected === undefined) diagnostics.push({ code: "missing_expected_hash", message: "Expected file hash/status is required.", path: target });
    else if (expected !== before.hash) diagnostics.push({ code: "stale_hash", message: "Expected hash does not match current target.", path: target });
    touchedFiles.push({ path: target, before, expected });
  }
  return { diagnostics, targets, touchedFiles };
}

export async function createSafePatchCheck(root: string, input: SafePatchInput): Promise<SafePatchCheckResult> {
  const validation = await validatePatchInput(root, input);
  if (validation.diagnostics.length > 0) return { valid: false, wouldMutate: false, touchedFiles: validation.touchedFiles, diagnostics: validation.diagnostics };
  const sandbox = await createPatchSandbox(root, validation.targets);
  try {
    const result = await runNativeCommand("git", ["apply", "--check"], {
      cwd: sandbox,
      input: input.patch,
      timeoutMs: SAFE_TOOLING_LIMITS.gitApplyCheckTimeoutMs,
    });
    if (result.status !== "ok" || result.exitCode !== 0) {
      return {
        valid: false,
        wouldMutate: false,
        touchedFiles: validation.touchedFiles,
        diagnostics: [{ code: result.status === "missing" ? "git_unavailable" : "git_apply_check_failed", message: "git apply --check failed." }],
        command: { exitCode: result.exitCode, stderr: boundedText(result.stderr) },
      };
    }
    return { valid: true, wouldMutate: false, touchedFiles: validation.touchedFiles, diagnostics: [], command: { exitCode: 0, stderr: "" } };
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

async function readPatchedBytes(sandbox: string, targets: readonly string[]): Promise<ReadonlyMap<string, Buffer | undefined>> {
  const patched = new Map<string, Buffer | undefined>();
  for (const target of targets) {
    const file = path.join(sandbox, target);
    try {
      await stat(file);
      patched.set(target, await readFile(file));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") patched.set(target, undefined);
      else throw error;
    }
  }
  return patched;
}

export async function createSafePatchApply(root: string, input: SafePatchInput): Promise<SafePatchApplyResult> {
  const check = await createSafePatchCheck(root, input);
  if (!check.valid) return { applied: false, touchedFiles: check.touchedFiles.map((file) => ({ ...file, after: file.before })), diagnostics: check.diagnostics };
  const lock = await acquireSafeToolingLock(root);
  if (!lock) return { applied: false, touchedFiles: check.touchedFiles.map((file) => ({ ...file, after: file.before })), diagnostics: [{ code: "locked", message: "Safe tooling lock is already held." }] };
  const sandbox = await createPatchSandbox(root, check.touchedFiles.map((file) => file.path));
  const backups = new Map<string, Buffer | undefined>();
  try {
    const apply = await runNativeCommand("git", ["apply"], { cwd: sandbox, input: input.patch, timeoutMs: SAFE_TOOLING_LIMITS.gitApplyCheckTimeoutMs });
    if (apply.status !== "ok" || apply.exitCode !== 0) return { applied: false, touchedFiles: check.touchedFiles.map((file) => ({ ...file, after: file.before })), diagnostics: [{ code: "git_apply_failed", message: "git apply failed in sandbox." }], lock: { path: lock.path } };
    const patched = await readPatchedBytes(sandbox, check.touchedFiles.map((file) => file.path));
    for (const file of check.touchedFiles) {
      const current = await hashSourceTarget(root, file.path);
      if (file.expected !== current.hash) return { applied: false, touchedFiles: check.touchedFiles.map((item) => ({ ...item, after: item.before })), diagnostics: [{ code: "stale_hash", message: "Target changed before apply.", path: file.path }], lock: { path: lock.path } };
      const resolved = resolvePathInsideRoot(root, file.path);
      if (!resolved) return { applied: false, touchedFiles: check.touchedFiles.map((item) => ({ ...item, after: item.before })), diagnostics: [{ code: "outside_root", message: "Target escapes root.", path: file.path }], lock: { path: lock.path } };
      backups.set(file.path, current.status === "present" ? await readFile(resolved) : undefined);
    }
    const written: string[] = [];
    try {
      for (const file of check.touchedFiles) {
        const resolved = resolvePathInsideRoot(root, file.path);
        const bytes = patched.get(file.path);
        if (!resolved) throw new Error(`Unsafe target: ${file.path}`);
        if (bytes === undefined) await removePathIfExists(resolved);
        else await writeBytesAtomic(resolved, bytes);
        written.push(file.path);
      }
    } catch (error) {
      for (const target of written.reverse()) {
        const bytes = backups.get(target);
        const resolved = resolvePathInsideRoot(root, target);
        if (!resolved) continue;
        if (bytes === undefined) await removePathIfExists(resolved);
        else await writeBytesAtomic(resolved, bytes);
      }
      const touchedFiles = await Promise.all(check.touchedFiles.map(async (file) => ({ ...file, after: await hashSourceTarget(root, file.path) })));
      return { applied: false, touchedFiles, diagnostics: [{ code: "apply_write_failed", message: error instanceof Error ? error.message : "Safe patch apply write failed." }], lock: { path: lock.path } };
    }
    const touchedFiles = await Promise.all(check.touchedFiles.map(async (file) => ({ ...file, after: await hashSourceTarget(root, file.path) })));
    return { applied: true, touchedFiles, diagnostics: [], lock: { path: lock.path } };
  } finally {
    await rm(sandbox, { recursive: true, force: true });
    await lock.release();
  }
}
