import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveTinyChuPaths } from "../state/paths.js";
import { TaskStore } from "../state/task-store.js";
import { createEnvironmentDoctor } from "./extension-environment.js";
import { runNativeCommand } from "./native-runner.js";
import { createSessionPreflight } from "./session-preflight.js";
import { createDefaultSmallContextRunGate, type SmallContextRunDirtyWorktreeDetector, type SmallContextRunGate } from "./small-context-run.js";

export type DoctorStatus = "ready" | "degraded" | "attention" | "blocked";
export type DoctorCheckStatus = DoctorStatus | "skipped";

export interface DoctorCheck {
  readonly section: string;
  readonly name: string;
  readonly status: DoctorCheckStatus;
  readonly message: string;
  readonly details?: unknown;
}

export interface DoctorSectionSummary {
  readonly section: string;
  readonly status: DoctorCheckStatus;
  readonly summary: string;
}

export interface DoctorInput {
  readonly toolNames?: readonly string[];
  readonly timeoutMs?: number;
  readonly expectedShellVersion?: string;
  readonly id?: string;
  readonly taskId?: string;
  readonly checkDirtyWorktree?: boolean;
  readonly checks?: readonly DoctorCheck[];
}

export interface DoctorResult {
  readonly status: DoctorStatus;
  readonly inputs: {
    readonly toolNames: readonly string[];
    readonly timeoutMs?: number;
    readonly taskId?: string;
  };
  readonly sections: readonly DoctorSectionSummary[];
  readonly checks: readonly DoctorCheck[];
  readonly remediation: readonly string[];
  readonly smallContextRun: SmallContextRunGate;
}

const STATUS_RANK: Record<DoctorCheckStatus, number> = { skipped: 0, ready: 1, degraded: 2, attention: 3, blocked: 4 };
const POWERSHELL_RUNTIME_VERSION = "7.6.2";
const GIT_STATUS_COMMAND = "git status --porcelain=v1 -z --untracked-files=no";
const DIRTY_WORKTREE_CHECK_STATUS: Record<SmallContextRunDirtyWorktreeDetector["status"], DoctorCheckStatus> = {
  clean: "ready",
  dirty: "attention",
  degraded: "degraded",
  skipped: "skipped",
};

type GitStatusResult =
  | { readonly kind: "ok"; readonly stdout: string }
  | { readonly kind: "failed"; readonly code?: string; readonly stderr: string; readonly message: string }
  | { readonly kind: "timed_out" };

function statusFromChecks(checks: readonly DoctorCheck[]): DoctorStatus {
  const status = checks.reduce<DoctorCheckStatus>((worst, check) => STATUS_RANK[check.status] > STATUS_RANK[worst] ? check.status : worst, "ready");
  return status === "skipped" ? "ready" : status;
}

function sectionSummaries(checks: readonly DoctorCheck[]): readonly DoctorSectionSummary[] {
  const sections = [...new Set(checks.map((check) => check.section))].sort();
  return sections.map((section) => {
    const scoped = checks.filter((check) => check.section === section);
    const status = scoped.reduce<DoctorCheckStatus>((worst, check) => STATUS_RANK[check.status] > STATUS_RANK[worst] ? check.status : worst, "skipped");
    return { section, status, summary: `${scoped.length} check(s)` };
  });
}

function envStatus(status: "ok" | "missing" | "error", required: boolean): DoctorCheckStatus {
  if (status === "ok") return "ready";
  return required ? "blocked" : "degraded";
}

function errorCode(error: unknown): string | undefined {
  if (error instanceof Error && "code" in error && typeof error.code === "string") return error.code;
  return undefined;
}

function parseDirtyTrackedFiles(stdout: string): readonly string[] {
  const entries = stdout.split("\0").filter((entry) => entry !== "");
  const files: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry || entry.length < 4) continue;
    const status = entry.slice(0, 2);
    const filePath = entry.slice(3);
    if (status !== "??" && filePath !== "") files.push(filePath);
    if (status.includes("R") || status.includes("C")) index += 1;
  }
  return files.sort();
}

async function runGitStatus(root: string, timeoutMs: number): Promise<GitStatusResult> {
  const result = await runNativeCommand("git", ["status", "--porcelain=v1", "-z", "--untracked-files=no"], {
    cwd: root,
    timeoutMs,
    maxStdoutBytes: 16 * 1024,
    maxStderrBytes: 4 * 1024,
  });
  if (result.status === "timeout" || result.timedOut) return { kind: "timed_out" };
  if (result.status === "missing") return { kind: "failed", code: "ENOENT", stderr: result.stderr, message: "git command is unavailable" };
  if (result.exitCode === 0) return { kind: "ok", stdout: result.stdout };
  return { kind: "failed", stderr: result.stderr, message: `git status exited with code ${result.exitCode ?? "unknown"}` };
}

async function detectDirtyWorktree(root: string, timeoutMs: number): Promise<SmallContextRunDirtyWorktreeDetector> {
  const result = await runGitStatus(root, timeoutMs);
  switch (result.kind) {
    case "ok": {
      const trackedFiles = parseDirtyTrackedFiles(result.stdout);
      return trackedFiles.length > 0
        ? { status: "dirty", command: GIT_STATUS_COMMAND, trackedFiles, message: `${trackedFiles.length} dirty tracked file(s)` }
        : { status: "clean", command: GIT_STATUS_COMMAND, trackedFiles: [], message: "No dirty tracked files" };
    }
    case "timed_out":
      return { status: "degraded", command: GIT_STATUS_COMMAND, trackedFiles: [], message: `git status timed out after ${timeoutMs}ms` };
    case "failed":
      if (result.stderr.includes("not a git repository")) {
        return { status: "skipped", command: GIT_STATUS_COMMAND, trackedFiles: [], message: "Root is not a Git repository" };
      }
      return {
        status: "degraded",
        command: GIT_STATUS_COMMAND,
        trackedFiles: [],
        message: result.code === "ENOENT" ? "git command is unavailable" : result.message,
      };
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}

function dirtyWorktreeCheck(detector: SmallContextRunDirtyWorktreeDetector): DoctorCheck {
  return { section: "small_context_run", name: "dirty_worktree", status: DIRTY_WORKTREE_CHECK_STATUS[detector.status], message: detector.message, details: detector };
}

async function readJsonFiles(dir: string, section: string, name: string): Promise<DoctorCheck[]> {
  const files = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!files) return [{ section, name, status: "skipped", message: `${dir} is absent` }];
  const checks: DoctorCheck[] = [];
  for (const file of files.filter((item) => item.endsWith(".json")).sort()) {
    try {
      JSON.parse(await readFile(path.join(dir, file), "utf8"));
    } catch (error) {
      checks.push({ section, name, status: "blocked", message: `Malformed JSON: ${file}`, details: error instanceof Error ? error.message : String(error) });
    }
  }
  if (checks.length > 0) return checks;
  return [{ section, name, status: "ready", message: `${files.filter((item) => item.endsWith(".json")).length} JSON file(s) readable` }];
}

async function runtimeChecks(root: string): Promise<DoctorCheck[]> {
  const paths = resolveTinyChuPaths(root);
  const taskChecks = await readJsonFiles(paths.tasksDir, "runtime_state", "tasks_json");
  const jobChecks = await readJsonFiles(paths.publicJobsDir, "runtime_state", "public_jobs_json");
  return [...taskChecks, ...jobChecks];
}

async function sessionChecks(root: string, input: DoctorInput): Promise<DoctorCheck[]> {
  const id = input.id;
  const taskId = input.taskId;
  if (id && taskId && id !== taskId) return [{ section: "session", name: "task_id_conflict", status: "blocked", message: "id and taskId differ" }];
  const selected = taskId ?? id;
  if (!selected) return [{ section: "session", name: "task_preflight", status: "skipped", message: "No task id supplied" }];
  try {
    const task = await new TaskStore({ root }).get(selected);
    if (!task) return [{ section: "session", name: "task_preflight", status: "attention", message: `Task not found: ${selected}` }];
    const preflight = createSessionPreflight(task, { maxFiles: 3, maxSnippets: 12, maxChunks: 4 });
    return [{ section: "session", name: "task_preflight", status: "ready", message: `Latest checkpoint count: ${task.checkpoints?.length ?? 0}`, details: preflight }];
  } catch (error) {
    const code = errorCode(error);
    return [{ section: "session", name: "task_preflight", status: code === "ENOENT" ? "attention" : "blocked", message: code === "ENOENT" ? `Task not found: ${selected}` : `Cannot read task: ${selected}`, details: error instanceof Error ? error.message : String(error) }];
  }
}

function smallContextSession(input: DoctorInput, checks: readonly DoctorCheck[]): SmallContextRunGate["session"] {
  const taskId = input.taskId ?? input.id;
  const preflight = checks.find((check) => check.section === "session" && check.name === "task_preflight");
  if (!preflight) return { ...(taskId ? { taskId } : {}), status: "skipped", message: "No session preflight check available" };
  switch (preflight.status) {
    case "ready":
      return { ...(taskId ? { taskId } : {}), status: "ready", message: preflight.message };
    case "attention":
      return { ...(taskId ? { taskId } : {}), status: "attention", message: preflight.message };
    case "blocked":
      return { ...(taskId ? { taskId } : {}), status: "blocked", message: preflight.message };
    default:
      return { ...(taskId ? { taskId } : {}), status: "skipped", message: preflight.message };
  }
}

export async function createDoctor(root: string | undefined, input: DoctorInput = {}): Promise<DoctorResult> {
  const configuredRoot = resolveTinyChuPaths(root).root;
  const dirtyWorktreeDetector = input.checkDirtyWorktree ? await detectDirtyWorktree(configuredRoot, input.timeoutMs ?? 800) : undefined;
  const environment = await createEnvironmentDoctor({ toolNames: input.toolNames, timeoutMs: input.timeoutMs });
  const checks: DoctorCheck[] = [
    ...environment.checks.map((check) => ({
      section: "environment",
      name: check.name,
      status: envStatus(check.status, check.required),
      message: `${check.command}: ${check.status}`,
      details: check,
    })),
    ...(await runtimeChecks(configuredRoot)),
    ...(await sessionChecks(configuredRoot, input)),
    ...(input.checks ?? []),
  ];
  if (input.expectedShellVersion && input.expectedShellVersion !== POWERSHELL_RUNTIME_VERSION) {
    checks.push({ section: "runtime", name: "powershell_runtime", status: "degraded", message: `Expected ${input.expectedShellVersion}, configured ${POWERSHELL_RUNTIME_VERSION}` });
  } else {
    checks.push({ section: "runtime", name: "powershell_runtime", status: "ready", message: `Configured ${POWERSHELL_RUNTIME_VERSION}` });
  }
  checks.push(
    { section: "small_context_run", name: "no_live_provider_calls", status: "ready", message: "Tiny-Chu small-context gate is local packet shaping only" },
    dirtyWorktreeDetector
      ? dirtyWorktreeCheck(dirtyWorktreeDetector)
      : { section: "small_context_run", name: "dirty_worktree_policy", status: "ready", message: "Executors must inspect git status --short and git diff -- <file>; doctor does not run git" },
  );
  const status = statusFromChecks(checks);
  return {
    status,
    inputs: { toolNames: input.toolNames ?? [], ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}), ...(input.taskId ?? input.id ? { taskId: input.taskId ?? input.id } : {}) },
    sections: sectionSummaries(checks),
    checks,
    remediation: environment.remediation,
    smallContextRun: createDefaultSmallContextRunGate({
      status,
      session: smallContextSession(input, checks),
      ...(dirtyWorktreeDetector ? { dirtyWorktreePolicy: { advisoryOnly: false, detector: dirtyWorktreeDetector } } : {}),
    }),
  };
}
