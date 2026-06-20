import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createDoctor, createTinyChuPlugin } from "../dist/index.js";
import { TinyChuOpenCodePlugin } from "../dist/opencode/plugin.js";

const execFileAsync = promisify(execFile);

async function git(root, args) {
  return execFileAsync("git", args, { cwd: root, maxBuffer: 1024 * 1024 });
}

test("doctor returns normalized sections and status precedence", async () => {
  const result = await createDoctor(undefined, { toolNames: ["node"], timeoutMs: 300 });
  assert.ok(["ready", "degraded", "attention", "blocked"].includes(result.status));
  assert.deepEqual(result.inputs.toolNames, ["node"]);
  assert.equal(result.inputs.timeoutMs, 300);
  assert.ok(result.sections.some((section) => section.section === "environment"));
  assert.ok(result.checks.some((check) => check.section === "environment" && check.name === "node"));
  const blocked = await createDoctor(undefined, { checks: [{ section: "custom", name: "bad", status: "blocked", message: "bad" }] });
  assert.equal(blocked.status, "blocked");
});

test("doctor is read-only and reports malformed runtime state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-doctor-"));
  const fresh = await createDoctor(root, { toolNames: ["node"] });
  assert.ok(fresh.sections.some((section) => section.section === "runtime_state"));
  await assert.rejects(() => access(path.join(root, ".tiny")), /ENOENT/);

  await mkdir(path.join(root, ".tiny", "tasks"), { recursive: true });
  await writeFile(path.join(root, ".tiny", "tasks", "T-bad.json"), "{not json", "utf8");
  const malformed = await createDoctor(root, { toolNames: ["node"] });
  assert.equal(malformed.status, "blocked");
  assert.ok(malformed.checks.some((check) => check.name === "tasks_json" && check.status === "blocked"));
});

test("doctor handles PowerShell mismatch and session ids", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-doctor-session-"));
  const plugin = createTinyChuPlugin({ root });
  const task = await plugin.tools.task_create({ title: "Doctor session" });
  await plugin.tools.task_checkpoint({ id: task.id, summary: "ready to resume", nextSteps: ["run doctor"] });

  const mismatch = await createDoctor(root, { taskId: task.id, expectedShellVersion: "0.0.0", toolNames: ["node"] });
  assert.ok(["degraded", "attention", "blocked"].includes(mismatch.status));
  assert.ok(mismatch.checks.some((check) => check.name === "powershell_runtime" && check.status === "degraded"));
  assert.ok(mismatch.sections.some((section) => section.section === "session"));
  assert.ok(mismatch.checks.some((check) => check.name === "task_preflight" && check.message === "Latest checkpoint count: 1"));

  const skipped = await createDoctor(root, { toolNames: ["node"] });
  assert.ok(skipped.checks.some((check) => check.section === "session" && check.status === "skipped"));

  const conflict = await createDoctor(root, { id: task.id, taskId: "T-other", toolNames: ["node"] });
  assert.equal(conflict.status, "blocked");
  assert.ok(conflict.checks.some((check) => check.name === "task_id_conflict"));
});

test("doctor returns small-context run gate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-doctor-small-context-"));
  const plugin = createTinyChuPlugin({ root });
  const task = await plugin.tools.task_create({ title: "Small-context gate" });
  await plugin.tools.task_checkpoint({ id: task.id, summary: "ready", nextSteps: ["run context_packet"] });
  const result = await createDoctor(root, { taskId: task.id, toolNames: ["node"], timeoutMs: 300 });

  assert.equal(result.smallContextRun.mode, "small_context");
  assert.equal(result.smallContextRun.noLiveProviderCalls, true);
  assert.equal(result.smallContextRun.session?.taskId, task.id);
  assert.ok(result.smallContextRun.requiredFirstTools.includes("doctor"));
  assert.ok(result.smallContextRun.requiredFirstTools.includes("context_packet"));
  assert.ok(result.smallContextRun.requiredFirstTools.includes("tool_usage_plan"));
  assert.ok(result.smallContextRun.requiredFirstTools.includes("task_checkpoint"));
  assert.match(result.smallContextRun.dirtyWorktreePolicy.commandChecklist.join("\n"), /git status --short/);
  assert.ok(["ready", "degraded", "attention", "blocked"].includes(result.smallContextRun.status));
  assert.ok(result.checks.some((check) => check.section === "small_context_run" && check.name === "no_live_provider_calls" && check.status === "ready"));
  await assert.rejects(() => access(path.join(root, ".tiny", "public-jobs")), /ENOENT/);
});

test("doctor can gate small-context runs on dirty tracked Git files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-doctor-dirty-git-"));
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "tiny-chu@example.com"]);
  await git(root, ["config", "user.name", "Tiny Chu"]);
  await writeFile(path.join(root, "tracked.txt"), "before\n", "utf8");
  await writeFile(path.join(root, "space name.txt"), "before\n", "utf8");
  await writeFile(path.join(root, "arrow old.txt"), "before\n", "utf8");
  await git(root, ["add", "."]);
  await git(root, ["-c", "commit.gpgsign=false", "commit", "-m", "init"]);
  await writeFile(path.join(root, "space name.txt"), "after\n", "utf8");
  await git(root, ["mv", "arrow old.txt", "arrow -> new.txt"]);
  await git(root, ["add", "tracked.txt"]);
  await writeFile(path.join(root, "tracked.txt"), "after\n", "utf8");

  const result = await createDoctor(root, { toolNames: ["node"], timeoutMs: 300, checkDirtyWorktree: true });
  const dirtyCheck = result.checks.find((check) => check.section === "small_context_run" && check.name === "dirty_worktree");

  assert.equal(result.smallContextRun.staleEvidence.dirtyWorktreeDetector, true);
  assert.equal(result.smallContextRun.dirtyWorktreePolicy.advisoryOnly, false);
  assert.equal(result.smallContextRun.dirtyWorktreePolicy.detector?.status, "dirty");
  assert.deepEqual(result.smallContextRun.dirtyWorktreePolicy.detector?.trackedFiles, ["arrow -> new.txt", "space name.txt", "tracked.txt"]);
  assert.equal(dirtyCheck?.status, "attention");
  assert.match(dirtyCheck?.message ?? "", /3 dirty tracked file/);
});

test("doctor dirty-worktree detector skips non-Git roots without blocking", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-doctor-non-git-"));

  const result = await createDoctor(root, { toolNames: ["node"], timeoutMs: 300, checkDirtyWorktree: true });
  const dirtyCheck = result.checks.find((check) => check.section === "small_context_run" && check.name === "dirty_worktree");

  assert.notEqual(result.status, "blocked");
  assert.equal(result.smallContextRun.staleEvidence.dirtyWorktreeDetector, true);
  assert.equal(result.smallContextRun.dirtyWorktreePolicy.detector?.status, "skipped");
  assert.deepEqual(result.smallContextRun.dirtyWorktreePolicy.detector?.trackedFiles, []);
  assert.equal(dirtyCheck?.status, "skipped");
});

test("OpenCode doctor bridge returns budgeted normalized output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-doctor-bridge-"));
  const hooks = await TinyChuOpenCodePlugin({
    project: { root },
    directory: root,
    worktree: root,
    client: { app: { log: async () => undefined } },
    $: async () => undefined,
  });
  assert.equal(typeof hooks.tool.doctor.execute, "function");
  const result = await hooks.tool.doctor.execute(
    { input: { toolNames: ["node"], timeoutMs: 300, maxOutputChars: 800, maxArrayItems: 2 } },
    {
      sessionID: "s1",
      messageID: "m1",
      agent: "test",
      directory: root,
      worktree: root,
      abort: new AbortController().signal,
      metadata: () => undefined,
      ask: async () => undefined,
    },
  );
  assert.equal(result.metadata.tool, "doctor");
  assert.match(result.output, /status/);
  assert.equal(result.metadata.budget.maxArrayItems, 2);
});
