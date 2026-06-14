import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeJsonAtomic } from "../state/file-store.js";
import { resolvePathInsideRoot } from "../state/path-safety.js";
import { readWorkspaceFile } from "./artifact-workspace.js";
import { acquireSafeToolingLock, ensureWritableTarget, hashSourceTarget, isPathUnderDirectory, isPreparedArtifactWorkspace, isTargetAllowed, normalizeSafeRelativePath, removePathIfExists, SAFE_TOOLING_LIMITS, writeBytesAtomic, type SafeToolingDiagnostic, type SourceTargetHash } from "./safe-tooling.js";

interface ArtifactPublishEntryInput {
  readonly source: string;
  readonly target: string;
}

interface ArtifactPublishManifestInput {
  readonly workspaceRoot: string;
  readonly entries: readonly ArtifactPublishEntryInput[];
  readonly allowedTargets: readonly string[];
}

interface ArtifactManifestEntry {
  readonly source: string;
  readonly target: string;
  readonly sourceHash: string;
  readonly targetBefore: SourceTargetHash;
  readonly targetAfter: string;
  readonly size: number;
  readonly mode: "100644";
  readonly allowedTargetPattern: string;
}

interface ArtifactPublishManifest {
  readonly manifestVersion: 1;
  readonly manifestId: string;
  readonly workspaceRoot: string;
  readonly entries: readonly ArtifactManifestEntry[];
}

export interface ArtifactPublishManifestResult extends ArtifactPublishManifest {
  readonly valid: boolean;
  readonly manifestPath: string;
  readonly diagnostics: readonly SafeToolingDiagnostic[];
}

export interface ArtifactPublishApplyResult {
  readonly applied: boolean;
  readonly dryRun: boolean;
  readonly entries: readonly ArtifactManifestEntry[];
  readonly diagnostics: readonly SafeToolingDiagnostic[];
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function firstAllowedPattern(target: string, allowedTargets: readonly string[]): string | undefined {
  return allowedTargets.find((pattern) => isTargetAllowed(target, [pattern]));
}

export async function createArtifactPublishManifest(root: string, input: ArtifactPublishManifestInput): Promise<ArtifactPublishManifestResult> {
  const diagnostics: SafeToolingDiagnostic[] = [];
  if (!(await isPreparedArtifactWorkspace(root, input.workspaceRoot))) {
    diagnostics.push({ code: "unprepared_workspace", message: "Workspace was not prepared by Tiny-Chu outside the source root." });
  }
  if (input.allowedTargets.length === 0) diagnostics.push({ code: "default_deny", message: "allowedTargets must be non-empty." });
  const entries: ArtifactManifestEntry[] = [];
  for (const entry of input.entries) {
    const source = normalizeSafeRelativePath(entry.source);
    const target = normalizeSafeRelativePath(entry.target);
    if (!source || !target) {
      diagnostics.push({ code: "unsafe_path", message: "Publish paths must be root-relative.", path: entry.target });
      continue;
    }
    const allowedPattern = firstAllowedPattern(target, input.allowedTargets);
    if (!allowedPattern) {
      diagnostics.push({ code: "disallowed_target", message: "Target is not allowlisted.", path: target });
      continue;
    }
    const bytes = await readWorkspaceFile(input.workspaceRoot, source);
    if (!bytes) {
      diagnostics.push({ code: "missing_workspace_source", message: "Workspace source is missing.", path: source });
      continue;
    }
    if (bytes.byteLength > SAFE_TOOLING_LIMITS.maxGeneratedFileBytes) diagnostics.push({ code: "generated_file_too_large", message: "Generated file exceeds byte cap.", path: source });
    const writeDiagnostic = await ensureWritableTarget(root, target, true);
    if (writeDiagnostic) diagnostics.push(writeDiagnostic);
    entries.push({
      source,
      target,
      sourceHash: sha256(bytes),
      targetBefore: await hashSourceTarget(root, target),
      targetAfter: sha256(bytes),
      size: bytes.byteLength,
      mode: "100644",
      allowedTargetPattern: allowedPattern,
    });
  }
  const manifestId = `artifact-${randomUUID()}`;
  const manifestPath = path.join(root, ".tiny", "artifacts", `${manifestId}.json`);
  const manifest = { manifestVersion: 1, manifestId, workspaceRoot: input.workspaceRoot, entries } satisfies ArtifactPublishManifest;
  if (diagnostics.length === 0) await writeJsonAtomic(manifestPath, manifest);
  return { ...manifest, valid: diagnostics.length === 0, manifestPath, diagnostics };
}

async function readManifest(root: string, file: string): Promise<ArtifactPublishManifest | undefined> {
  const artifactsDir = path.join(root, ".tiny", "artifacts");
  if (!(await isPathUnderDirectory(artifactsDir, file).catch(() => false))) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const manifestVersion = Object.getOwnPropertyDescriptor(parsed, "manifestVersion")?.value;
  const manifestId = Object.getOwnPropertyDescriptor(parsed, "manifestId")?.value;
  const workspaceRoot = Object.getOwnPropertyDescriptor(parsed, "workspaceRoot")?.value;
  const rawEntries = Object.getOwnPropertyDescriptor(parsed, "entries")?.value;
  if (manifestVersion !== 1 || typeof manifestId !== "string" || typeof workspaceRoot !== "string" || !Array.isArray(rawEntries)) return undefined;
  const entries: ArtifactManifestEntry[] = [];
  for (const entry of rawEntries) {
    if (typeof entry !== "object" || entry === null) return undefined;
    const source = Object.getOwnPropertyDescriptor(entry, "source")?.value;
    const target = Object.getOwnPropertyDescriptor(entry, "target")?.value;
    const sourceHash = Object.getOwnPropertyDescriptor(entry, "sourceHash")?.value;
    const targetAfter = Object.getOwnPropertyDescriptor(entry, "targetAfter")?.value;
    const allowedTargetPattern = Object.getOwnPropertyDescriptor(entry, "allowedTargetPattern")?.value;
    const size = Object.getOwnPropertyDescriptor(entry, "size")?.value;
    const mode = Object.getOwnPropertyDescriptor(entry, "mode")?.value;
    const targetBefore = Object.getOwnPropertyDescriptor(entry, "targetBefore")?.value;
    if (typeof source !== "string" || typeof target !== "string" || typeof sourceHash !== "string" || typeof targetAfter !== "string" || typeof allowedTargetPattern !== "string") return undefined;
    if (typeof size !== "number" || mode !== "100644" || typeof targetBefore !== "object" || targetBefore === null) return undefined;
    const beforePath = Object.getOwnPropertyDescriptor(targetBefore, "path")?.value;
    const beforeStatus = Object.getOwnPropertyDescriptor(targetBefore, "status")?.value;
    const beforeHash = Object.getOwnPropertyDescriptor(targetBefore, "hash")?.value;
    if (typeof beforePath !== "string" || typeof beforeHash !== "string") return undefined;
    if (beforeStatus !== "present" && beforeStatus !== "missing" && beforeStatus !== "symlink") return undefined;
    entries.push({
      source,
      target,
      sourceHash,
      targetBefore: { path: beforePath, status: beforeStatus, hash: beforeHash },
      targetAfter,
      size,
      mode,
      allowedTargetPattern,
    });
  }
  return { manifestVersion: 1, manifestId, workspaceRoot, entries };
}

async function validateApply(root: string, manifest: ArtifactPublishManifest): Promise<SafeToolingDiagnostic[]> {
  const diagnostics: SafeToolingDiagnostic[] = [];
  for (const entry of manifest.entries) {
    if (!isTargetAllowed(entry.target, [entry.allowedTargetPattern])) diagnostics.push({ code: "disallowed_target", message: "Target is not allowlisted.", path: entry.target });
    const unsafe = await ensureWritableTarget(root, entry.target, entry.targetBefore.status === "missing");
    if (unsafe) diagnostics.push(unsafe);
    const current = await hashSourceTarget(root, entry.target);
    if (current.hash !== entry.targetBefore.hash) diagnostics.push({ code: "stale_hash", message: "Target hash changed after manifest creation.", path: entry.target });
    const bytes = await readWorkspaceFile(manifest.workspaceRoot, entry.source);
    if (!bytes || sha256(bytes) !== entry.sourceHash) diagnostics.push({ code: "workspace_source_changed", message: "Workspace source is missing or changed.", path: entry.source });
  }
  return diagnostics;
}

export async function createArtifactPublishApply(root: string, input: { readonly manifestPath: string; readonly dryRun?: boolean }): Promise<ArtifactPublishApplyResult> {
  const manifest = await readManifest(root, input.manifestPath);
  if (!manifest || !(await isPreparedArtifactWorkspace(root, manifest.workspaceRoot))) {
    return { applied: false, dryRun: input.dryRun === true, entries: [], diagnostics: [{ code: "untrusted_manifest", message: "Manifest must be a Tiny-Chu artifact manifest under .tiny/artifacts." }] };
  }
  const diagnostics = await validateApply(root, manifest);
  if (diagnostics.length > 0 || input.dryRun === true) return { applied: false, dryRun: input.dryRun === true, entries: manifest.entries, diagnostics };
  const lock = await acquireSafeToolingLock(root);
  if (!lock) return { applied: false, dryRun: false, entries: manifest.entries, diagnostics: [{ code: "locked", message: "Safe tooling lock is already held." }] };
  const backups = new Map<string, Buffer | undefined>();
  try {
    const lockedDiagnostics = await validateApply(root, manifest);
    if (lockedDiagnostics.length > 0) return { applied: false, dryRun: false, entries: manifest.entries, diagnostics: lockedDiagnostics };
    for (const entry of manifest.entries) {
      const target = resolvePathInsideRoot(root, entry.target);
      if (!target) return { applied: false, dryRun: false, entries: manifest.entries, diagnostics: [{ code: "outside_root", message: "Target escapes root.", path: entry.target }] };
      backups.set(entry.target, entry.targetBefore.status === "present" ? await readFile(target) : undefined);
    }
    const written: string[] = [];
    try {
      for (const entry of manifest.entries) {
        const target = resolvePathInsideRoot(root, entry.target);
        const source = normalizeSafeRelativePath(entry.source);
        const bytes = source ? await readWorkspaceFile(manifest.workspaceRoot, source) : undefined;
        if (!target || !bytes) throw new Error(`Unsafe publish path: ${entry.target}`);
        await writeBytesAtomic(target, bytes);
        written.push(entry.target);
      }
    } catch (error) {
      for (const targetPath of written.reverse()) {
        const bytes = backups.get(targetPath);
        const target = resolvePathInsideRoot(root, targetPath);
        if (!target) continue;
        if (bytes === undefined) await removePathIfExists(target);
        else await writeBytesAtomic(target, bytes);
      }
      return { applied: false, dryRun: false, entries: manifest.entries, diagnostics: [{ code: "publish_write_failed", message: error instanceof Error ? error.message : "Publish write failed." }] };
    }
    for (const entry of manifest.entries) {
      const target = resolvePathInsideRoot(root, entry.target);
      if (!target) continue;
      const after = await hashSourceTarget(root, entry.target);
      if (after.hash !== entry.targetAfter) return { applied: false, dryRun: false, entries: manifest.entries, diagnostics: [{ code: "post_write_hash_mismatch", message: "Published target hash did not match manifest.", path: entry.target }] };
    }
    return { applied: true, dryRun: false, entries: manifest.entries, diagnostics: [] };
  } finally {
    await lock.release();
  }
}
