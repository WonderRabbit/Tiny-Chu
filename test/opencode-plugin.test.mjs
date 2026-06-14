import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTinyChuPlugin, hashSourceTarget } from "../dist/index.js";
import { TinyChuOpenCodePlugin } from "../dist/opencode/plugin.js";

test("package exposes an OpenCode plugin entrypoint", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(packageJson.exports["./opencode"], "./dist/opencode/plugin.js");
  assert.match(await readFile("README.md", "utf8"), /\.opencode\/plugins\/tiny-chu\.ts/);
  assert.match(await readFile(".opencode/plugins/tiny-chu.ts", "utf8"), /TinyChuOpenCodePlugin as TinyChu/);
  const openCodePackage = JSON.parse(await readFile(".opencode/package.json", "utf8"));
  assert.equal(openCodePackage.dependencies["@opencode-ai/plugin"], packageJson.dependencies["@opencode-ai/plugin"]);
  assert.equal(typeof TinyChuOpenCodePlugin, "function");
});

test("OpenCode plugin entrypoint exposes Tiny-Chu tools", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-opencode-"));
  const hooks = await TinyChuOpenCodePlugin({
    project: { root },
    directory: root,
    worktree: root,
    client: { app: { log: async () => undefined } },
    $: async () => undefined,
  });
  assert.ok(hooks.tool);
  assert.equal(typeof hooks.tool.context_bundle.execute, "function");
  assert.equal(typeof hooks.tool.git_weekly_report?.execute, "function");
  assert.equal(typeof hooks.tool.task_create.execute, "function");
  assert.equal(typeof hooks.tool.tiny_chu_install_check.execute, "function");
  const env = {};
  await hooks["shell.env"]?.({ cwd: root }, { env });
  assert.equal(env.TINY_CHU_ROOT, root);
  assert.equal(env.TINY_CHU_OPENCODE_PLUGIN, "1");
});

test("OpenCode plugin entrypoint exposes safe tooling only when opted in", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-opencode-safe-tooling-"));
  const defaultHooks = await TinyChuOpenCodePlugin({
    project: { root },
    directory: root,
    worktree: root,
    client: { app: { log: async () => undefined } },
    $: async () => undefined,
  });
  const optedInHooks = await TinyChuOpenCodePlugin({
    project: { root },
    directory: root,
    worktree: root,
    client: { app: { log: async () => undefined } },
    $: async () => undefined,
  }, { safeTooling: true, nativePreviews: true });

  assert.equal(defaultHooks.tool.safe_patch_check, undefined);
  assert.equal(defaultHooks.tool.structural_search_ast, undefined);
  assert.equal(typeof optedInHooks.tool.safe_patch_check.execute, "function");
  assert.equal(typeof optedInHooks.tool.artifact_publish_apply.execute, "function");
  assert.equal(typeof optedInHooks.tool.structural_search_ast.execute, "function");
});

test("direct plugin safe tooling handlers run through the public tool surface", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-direct-safe-tooling-"));
  await writeFile(path.join(root, "note.txt"), "old\n", "utf8");
  const tiny = createTinyChuPlugin({ root, safeTooling: true });
  const before = await hashSourceTarget(root, "note.txt");
  const patch = [
    "diff --git a/note.txt b/note.txt",
    "--- a/note.txt",
    "+++ b/note.txt",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");

  const checked = await tiny.tools.safe_patch_check({ patch, allowedTargets: ["note.txt"], expectedFiles: { "note.txt": before.hash } });
  const applied = await tiny.tools.safe_patch_apply({ patch, allowedTargets: ["note.txt"], expectedFiles: { "note.txt": before.hash } });

  assert.equal(checked.valid, true);
  assert.equal(applied.applied, true);
  assert.equal(await readFile(path.join(root, "note.txt"), "utf8"), "new\n");
});

test("README documents git_weekly_report as an OpenCode-visible Tiny-Chu tool", async () => {
  const readme = await readFile("README.md", "utf8");

  assert.match(readme, /git_weekly_report/);
  assert.match(readme, /\.tiny\/reports\/git-weekly/);
  assert.match(readme, /5 business days|five business days/i);
});

test("OpenCode tool output is budgeted without changing the library tool contract", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-opencode-budget-"));
  const hooks = await TinyChuOpenCodePlugin({
    project: { root },
    directory: root,
    worktree: root,
    client: { app: { log: async () => undefined } },
    $: async () => undefined,
  });
  const abort = new AbortController();
  const result = await hooks.tool.orchestration_profile.execute(
    { input: { maxOutputChars: 1200, maxArrayItems: 2 } },
    {
      sessionID: "s1",
      messageID: "m1",
      agent: "test",
      directory: root,
      worktree: root,
      abort: abort.signal,
      metadata: () => undefined,
      ask: async () => undefined,
    },
  );
  assert.equal(typeof result, "object");
  assert.equal(result.metadata.truncated, true);
  assert.equal(result.metadata.budget.maxArrayItems, 2);
  assert.ok(result.metadata.budget.fullSizeChars > result.metadata.budget.outputSizeChars);
  assert.ok(result.output.length <= 1200);
  assert.match(result.output, /omittedItems=/);
});

test("small-context operating-mode smoke uses local tools only", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-small-context-smoke-"));
  const tiny = createTinyChuPlugin({ root });

  const doctor = await tiny.tools.doctor({ toolNames: ["node"], timeoutMs: 300 });
  const profile = await tiny.tools.orchestration_profile({});
  const plan = await tiny.tools.tool_usage_plan({ objective: "small-context operating-mode correction for project-wide optimization" });
  const packets = await tiny.tools.worker_packet_optimizer({
    objective: "small-context operating-mode correction",
    evidenceRefs: ["src/opencode/tool-plan.ts:197"],
    dispatch: false,
  });
  const jobs = await readdir(path.join(root, ".tiny", "public-jobs")).catch(() => []);
  const mode = profile.smallContextRun ?? profile.operatingModes?.smallContextRun ?? doctor.smallContextRun;
  const visibleTools = plan.steps.flatMap((step) => [step.tinyTool, step.nativeTool].filter(Boolean));

  assert.ok(mode);
  assert.ok(visibleTools.includes("session_preflight"));
  assert.equal(mode.noLiveProviderCalls ?? packets.noLiveProviderCalls, true);
  assert.ok(mode.correctionWorkflow.some((step) => step.tinyTool === "artifact_pack_manifest"));
  assert.ok(plan.steps.length <= 8);
  assert.ok(plan.verification.requiredTools.includes("task_checkpoint"));
  assert.ok(packets.packets.length > 0);
  assert.deepEqual(jobs, []);
});

test("OpenCode plugin entrypoint bridges Tiny-Chu prompt context", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-opencode-chat-"));
  await readFile("README.md", "utf8");
  const hooks = await TinyChuOpenCodePlugin({
    project: { root },
    directory: root,
    worktree: root,
    client: { app: { log: async () => undefined } },
    $: async () => undefined,
  });
  const output = {
    message: { id: "m1", sessionID: "s1", role: "user" },
    parts: [{ id: "p1", sessionID: "s1", messageID: "m1", type: "text", text: "ulw inspect this" }],
  };
  await hooks["chat.message"]?.({ sessionID: "s1" }, output);
  assert.match(output.parts[0].text, /tiny-chu-context/);
  assert.match(output.parts[0].text, /tiny-chu-small-context/);
  assert.match(output.parts[0].text, /tiny-chu-powershell-tooling/);
});

test("compaction includes Tiny-Chu focus packet", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-opencode-compaction-"));
  const hooks = await TinyChuOpenCodePlugin({
    project: { root },
    directory: root,
    worktree: root,
    client: { app: { log: async () => undefined } },
    $: async () => undefined,
  });
  await hooks.tool.task_create.execute(
    { input: { title: "Resume me" } },
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
  const compaction = { context: [] };
  await hooks["experimental.session.compacting"]?.({ sessionID: "s1" }, compaction);
  assert.match(compaction.context.join("\n"), /Resume me|task_focus_packet/);
});
