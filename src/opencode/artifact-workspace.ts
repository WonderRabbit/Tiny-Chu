import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolvePathInsideRoot } from "../state/path-safety.js";
import { runNativeCommand } from "./native-runner.js";
import { copyFileEnsuringDir, ensureWritableTarget, isPreparedArtifactWorkspace, isTargetAllowed, normalizeSafeRelativePath, type SafeToolingDiagnostic } from "./safe-tooling.js";

export interface ArtifactWorkspacePrepareInput {
  readonly allowedInputs: readonly string[];
  readonly copyInputs?: readonly string[];
  readonly initGit?: boolean;
  readonly purpose?: string;
}

export interface ArtifactWorkspacePrepareResult {
  readonly valid: boolean;
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly copiedInputs: readonly string[];
  readonly diagnostics: readonly SafeToolingDiagnostic[];
}

export interface ArtifactWorkspaceCommitResult {
  readonly valid: boolean;
  readonly commit: string;
  readonly diagnostics: readonly SafeToolingDiagnostic[];
}

export async function createArtifactWorkspacePrepare(root: string, input: ArtifactWorkspacePrepareInput): Promise<ArtifactWorkspacePrepareResult> {
  const workspaceId = `artifact-${randomUUID()}`;
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), `tiny-chu-${workspaceId}-`));
  const diagnostics: SafeToolingDiagnostic[] = [];
  if (input.allowedInputs.length === 0) diagnostics.push({ code: "default_deny", message: "allowedInputs must be non-empty." });
  const copiedInputs: string[] = [];
  for (const rawInput of input.copyInputs ?? []) {
    const candidate = normalizeSafeRelativePath(rawInput);
    if (!candidate || !isTargetAllowed(candidate, input.allowedInputs)) {
      diagnostics.push({ code: "disallowed_input", message: "Input path is not allowlisted.", path: rawInput });
      continue;
    }
    const unsafe = await ensureWritableTarget(root, candidate, false);
    if (unsafe) {
      diagnostics.push(unsafe);
      continue;
    }
    const source = resolvePathInsideRoot(root, candidate);
    if (!source) {
      diagnostics.push({ code: "outside_root", message: "Input path escapes root.", path: candidate });
      continue;
    }
    await copyFileEnsuringDir(source, path.join(workspaceRoot, candidate));
    copiedInputs.push(candidate);
  }
  if (diagnostics.length > 0) return { valid: false, workspaceId, workspaceRoot, copiedInputs, diagnostics };
  await writeFile(path.join(workspaceRoot, ".tiny-chu-workspace.json"), JSON.stringify({ workspaceId, purpose: input.purpose ?? "artifact" }), "utf8");
  if (input.initGit === true) {
    const init = await runNativeCommand("git", ["init"], { cwd: workspaceRoot });
    if (init.status !== "ok" || init.exitCode !== 0) {
      return { valid: false, workspaceId, workspaceRoot, copiedInputs, diagnostics: [{ code: "git_init_failed", message: "Could not initialize artifact workspace git repository." }] };
    }
  }
  return { valid: true, workspaceId, workspaceRoot, copiedInputs, diagnostics: [] };
}

export async function createArtifactWorkspaceCommit(_root: string, input: { readonly workspaceRoot: string; readonly message?: string }): Promise<ArtifactWorkspaceCommitResult> {
  if (!(await isPreparedArtifactWorkspace(_root, input.workspaceRoot))) {
    return { valid: false, commit: "", diagnostics: [{ code: "unprepared_workspace", message: "Workspace was not prepared by Tiny-Chu outside the source root." }] };
  }
  const configName = await runNativeCommand("git", ["config", "user.name", "Tiny-Chu Artifact"], { cwd: input.workspaceRoot });
  const configEmail = await runNativeCommand("git", ["config", "user.email", "tiny-chu@local.invalid"], { cwd: input.workspaceRoot });
  const add = await runNativeCommand("git", ["add", "."], { cwd: input.workspaceRoot });
  const commit = await runNativeCommand("git", ["commit", "-m", input.message ?? "tiny-chu artifact workspace"], { cwd: input.workspaceRoot });
  if ([configName, configEmail, add, commit].some((result) => result.status !== "ok" || result.exitCode !== 0)) {
    return { valid: false, commit: "", diagnostics: [{ code: "git_commit_failed", message: "Could not commit artifact workspace." }] };
  }
  const rev = await runNativeCommand("git", ["rev-parse", "HEAD"], { cwd: input.workspaceRoot });
  return { valid: true, commit: rev.stdout.trim(), diagnostics: [] };
}

export async function readWorkspaceFile(workspaceRoot: string, relativePath: string): Promise<Buffer | undefined> {
  const safe = normalizeSafeRelativePath(relativePath);
  if (!safe) return undefined;
  const file = path.join(workspaceRoot, safe);
  try {
    const info = await lstat(file);
    if (info.isSymbolicLink()) return undefined;
    const [realWorkspace, realFile] = await Promise.all([realpath(workspaceRoot), realpath(file)]);
    const relative = path.relative(realWorkspace, realFile);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
    return await readFile(realFile);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}
