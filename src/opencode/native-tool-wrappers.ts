import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { resolvePathInsideRoot } from "../state/path-safety.js";
import { runNativeCommand, type NativeCommandResult, type NativeRunner } from "./native-runner.js";
import { boundedText, normalizeSafeRelativePath, SAFE_TOOLING_LIMITS } from "./safe-tooling.js";

export type NativePreviewStatus = "ready" | "failed" | "unavailable";

interface NativePreviewBaseInput {
  readonly runner?: NativeRunner;
}

export interface StructuralSearchAstInput extends NativePreviewBaseInput {
  readonly pattern: string;
  readonly language: string;
  readonly paths: readonly string[];
}

export interface StructuralRewritePreviewInput extends StructuralSearchAstInput {
  readonly rewrite: string;
}

export interface JsonYamlTransformPreviewInput extends NativePreviewBaseInput {
  readonly tool: "jq" | "yq";
  readonly expression: string;
  readonly input: string;
}

export interface JsonPatchPreviewInput extends NativePreviewBaseInput {
  readonly before: string;
  readonly after: string;
}

function statusFromResult(result: NativeCommandResult): NativePreviewStatus {
  if (result.status === "missing") return "unavailable";
  return result.status === "ok" && result.exitCode === 0 ? "ready" : "failed";
}

function unavailableResult(result: NativeCommandResult): { readonly status: NativePreviewStatus; readonly diagnostics: readonly string[] } {
  return {
    status: statusFromResult(result),
    diagnostics: result.status === "missing" ? [`Missing optional native tool: ${result.command}`] : [boundedText(result.stderr || result.stdout)],
  };
}

async function normalizePreviewPaths(root: string, paths: readonly string[]): Promise<readonly string[] | undefined> {
  const normalized: string[] = [];
  const realRoot = await realpath(root);
  for (const item of paths) {
    const safe = normalizeSafeRelativePath(item);
    if (!safe) return undefined;
    const resolved = resolvePathInsideRoot(root, safe);
    if (!resolved) return undefined;
    try {
      await lstat(resolved);
      const realTarget = await realpath(resolved);
      const relative = path.relative(realRoot, realTarget);
      if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      const realParent = await realpath(path.dirname(resolved));
      const relative = path.relative(realRoot, realParent);
      if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
    }
    normalized.push(safe);
  }
  return normalized;
}

export async function createStructuralSearchAst(_root: string, input: StructuralSearchAstInput): Promise<{
  readonly status: NativePreviewStatus;
  readonly matches: readonly unknown[];
  readonly diagnostics: readonly string[];
}> {
  const runner = input.runner ?? runNativeCommand;
  const paths = await normalizePreviewPaths(_root, input.paths);
  if (!paths) return { status: "failed", matches: [], diagnostics: ["Native preview paths must be root-relative and cannot traverse."] };
  const result = await runner("ast-grep", ["--json", "--pattern", input.pattern, "--lang", input.language, ...paths], { cwd: _root, timeoutMs: SAFE_TOOLING_LIMITS.nativeTimeoutMs });
  if (result.status !== "ok" || result.exitCode !== 0) return { ...unavailableResult(result), matches: [] };
  let matches: readonly unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    matches = Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    return { status: "failed", matches: [], diagnostics: ["ast-grep returned invalid JSON."] };
  }
  return { status: "ready", matches, diagnostics: [] };
}

export async function createStructuralRewritePreview(_root: string, input: StructuralRewritePreviewInput): Promise<{
  readonly status: NativePreviewStatus;
  readonly preview: string;
  readonly requiresApplyTool: "safe_patch_apply";
  readonly diagnostics: readonly string[];
}> {
  const runner = input.runner ?? runNativeCommand;
  const paths = await normalizePreviewPaths(_root, input.paths);
  if (!paths) return { status: "failed", preview: "", requiresApplyTool: "safe_patch_apply", diagnostics: ["Native preview paths must be root-relative and cannot traverse."] };
  const result = await runner("ast-grep", ["--pattern", input.pattern, "--rewrite", input.rewrite, "--lang", input.language, "--update-all", "--dry-run", ...paths], { cwd: _root, timeoutMs: SAFE_TOOLING_LIMITS.nativeTimeoutMs });
  if (result.status !== "ok" || result.exitCode !== 0) return { ...unavailableResult(result), preview: "", requiresApplyTool: "safe_patch_apply" };
  return { status: "ready", preview: boundedText(result.stdout), requiresApplyTool: "safe_patch_apply", diagnostics: [] };
}

export async function createJsonYamlTransformPreview(_root: string, input: JsonYamlTransformPreviewInput): Promise<{
  readonly status: NativePreviewStatus;
  readonly output: string;
  readonly wouldWrite: false;
  readonly diagnostics: readonly string[];
}> {
  const runner = input.runner ?? runNativeCommand;
  const args = input.tool === "jq" ? [input.expression] : ["eval", input.expression, "-"];
  const result = await runner(input.tool, args, { input: input.input, timeoutMs: SAFE_TOOLING_LIMITS.nativeTimeoutMs });
  if (result.status !== "ok" || result.exitCode !== 0) return { ...unavailableResult(result), output: "", wouldWrite: false };
  return { status: "ready", output: boundedText(result.stdout), wouldWrite: false, diagnostics: [] };
}

export async function createJsonPatchPreview(_root: string, input: JsonPatchPreviewInput): Promise<{
  readonly status: NativePreviewStatus;
  readonly patch: string;
  readonly requiresApplyTool: "artifact_publish_apply";
  readonly diagnostics: readonly string[];
}> {
  const runner = input.runner ?? runNativeCommand;
  const result = await runner("jd", ["-set"], { input: `${input.before}\n${input.after}`, timeoutMs: SAFE_TOOLING_LIMITS.nativeTimeoutMs });
  if (result.status !== "ok" || result.exitCode !== 0) return { ...unavailableResult(result), patch: "", requiresApplyTool: "artifact_publish_apply" };
  return { status: "ready", patch: boundedText(result.stdout), requiresApplyTool: "artifact_publish_apply", diagnostics: [] };
}
