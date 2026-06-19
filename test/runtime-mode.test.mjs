import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTinyChuPlugin } from "../dist/index.js";
import { TinyChuOpenCodePlugin } from "../dist/opencode/plugin.js";

const WORKER_MODE_ALIASES = [1, "1", "mode1", "worker", "worker_only"];
const ORCHESTRATOR_WORKER_MODE_ALIASES = [2, "2", "mode2", "orchestrator_worker"];
const WORKER_HIDDEN_TOOLS = [
  "analysis_workflow_start",
  "button_workflow_dispatch",
  "public_cancel",
  "public_checkpoint",
  "public_collect",
  "public_complete",
  "public_dispatch",
  "public_job_resume_packet",
  "public_retry",
  "workflow_audit",
  "workflow_checkpoint",
  "workflow_close",
  "workflow_create",
  "workflow_next",
  "workflow_packet_fit_check",
  "workflow_progress_heartbeat",
  "workflow_resume_packet",
  "workflow_sot_audit",
  "workflow_status",
];
const WORKER_VISIBLE_TOOLS = [
  "context_bundle",
  "context_packet",
  "dashboard_snapshot",
  "orchestration_profile",
  "task_create",
  "tiny_chu_install_check",
  "wiki_bundle",
  "worker_packet_optimizer",
];

function fakeOpenCodeInput(root) {
  return {
    project: { root },
    directory: root,
    worktree: root,
    client: { app: { log: async () => undefined } },
    $: async () => undefined,
  };
}

function fakeToolContext(root) {
  return {
    sessionID: "s1",
    messageID: "m1",
    agent: "test",
    directory: root,
    worktree: root,
    abort: new AbortController().signal,
    metadata: () => undefined,
    ask: async () => undefined,
  };
}

async function readOpenCodeInstallCheck(hooks, root) {
  const result = await hooks.tool.tiny_chu_install_check.execute({ input: {} }, fakeToolContext(root));
  return JSON.parse(result.output);
}

async function temporaryRoot(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

test("mode 1 aliases expose worker-only direct and OpenCode tool surfaces", async () => {
  for (const mode of WORKER_MODE_ALIASES) {
    const root = await temporaryRoot("tiny-chu-worker-mode-");
    const tiny = createTinyChuPlugin({ root, mode });
    const hooks = await TinyChuOpenCodePlugin(fakeOpenCodeInput(root), { mode });
    const install = await tiny.tools.tiny_chu_install_check({});
    const bridgeInstall = await readOpenCodeInstallCheck(hooks, root);
    const env = {};

    await hooks["shell.env"]?.({ cwd: root }, { env });

    assert.equal(tiny.runtimeMode, "worker");
    assert.equal(install.runtimeMode, "worker");
    assert.equal(bridgeInstall.runtimeMode, "worker");
    assert.equal(env.TINY_CHU_MODE, "worker");
    for (const name of WORKER_VISIBLE_TOOLS) {
      assert.equal(typeof tiny.tools[name], "function", `${String(mode)} should expose direct ${name}`);
      assert.equal(typeof hooks.tool[name]?.execute, "function", `${String(mode)} should expose OpenCode ${name}`);
    }
    for (const name of WORKER_HIDDEN_TOOLS) {
      assert.equal(tiny.tools[name], undefined, `${String(mode)} should hide direct ${name}`);
      assert.equal(hooks.tool[name], undefined, `${String(mode)} should hide OpenCode ${name}`);
      assert.equal(install.requiredTools.includes(name), false, `${String(mode)} install-check should omit ${name}`);
      assert.equal(bridgeInstall.requiredTools.includes(name), false, `${String(mode)} bridge install-check should omit ${name}`);
    }
  }
});

test("mode 2 aliases and omitted mode preserve orchestrator-worker surface", async () => {
  for (const mode of [undefined, ...ORCHESTRATOR_WORKER_MODE_ALIASES]) {
    const root = await temporaryRoot("tiny-chu-orchestrator-worker-mode-");
    const config = mode === undefined ? { root } : { root, mode };
    const options = mode === undefined ? undefined : { mode };
    const tiny = createTinyChuPlugin(config);
    const hooks = await TinyChuOpenCodePlugin(fakeOpenCodeInput(root), options);
    const install = await tiny.tools.tiny_chu_install_check({});
    const bridgeInstall = await readOpenCodeInstallCheck(hooks, root);
    const env = {};

    await hooks["shell.env"]?.({ cwd: root }, { env });

    assert.equal(tiny.runtimeMode, "orchestrator_worker");
    assert.equal(install.runtimeMode, "orchestrator_worker");
    assert.equal(bridgeInstall.runtimeMode, "orchestrator_worker");
    assert.equal(env.TINY_CHU_MODE, "orchestrator_worker");
    for (const name of WORKER_HIDDEN_TOOLS) {
      assert.equal(typeof tiny.tools[name], "function", `${String(mode)} should expose direct ${name}`);
      assert.equal(typeof hooks.tool[name]?.execute, "function", `${String(mode)} should expose OpenCode ${name}`);
      assert.equal(install.requiredTools.includes(name), true, `${String(mode)} install-check should include ${name}`);
      assert.equal(bridgeInstall.requiredTools.includes(name), true, `${String(mode)} bridge install-check should include ${name}`);
    }
  }
});

test("invalid runtime mode values fail fast at direct and OpenCode boundaries", async () => {
  const root = await temporaryRoot("tiny-chu-invalid-mode-");
  for (const mode of ["", "mode3", "orchestrator", "worker-only", 3]) {
    assert.throws(() => createTinyChuPlugin({ root, mode }), /Invalid Tiny-Chu mode/);
    await assert.rejects(() => TinyChuOpenCodePlugin(fakeOpenCodeInput(root), { mode }), /Invalid Tiny-Chu mode/);
  }
});

test("worker mode prompt and profile avoid orchestration and public queue guidance", async () => {
  const root = await temporaryRoot("tiny-chu-worker-prompt-");
  const worker = createTinyChuPlugin({ root, mode: 1 });
  const orchestratorWorker = createTinyChuPlugin({ root, mode: 2 });

  const workerProfile = await worker.tools.orchestration_profile({});
  const workerPrompt = await worker.hooks.transformUserMessage("ulw inspect this", { targetPath: "." });
  const orchestratorPrompt = await orchestratorWorker.hooks.transformUserMessage("ulw inspect this", { targetPath: "." });
  const workerGuidance = `${JSON.stringify(workerProfile)}\n${workerPrompt}`;

  assert.equal(workerProfile.runtimeMode, "worker");
  assert.match(workerPrompt, /tiny-chu-context/);
  assert.match(workerPrompt, /tiny-chu-powershell-tooling/);
  assert.doesNotMatch(workerPrompt, /tiny-chu-small-context/);
  assert.doesNotMatch(workerGuidance, /public_dispatch|workflow_next|analysis_workflow_start|workflow_sot_audit/);
  assert.doesNotMatch(workerGuidance, /public queue/);
  assert.match(orchestratorPrompt, /tiny-chu-small-context/);
  assert.match(orchestratorPrompt, /public_dispatch|workflow_next/);
});

test("worker mode tool plans and qwen retry policy avoid hidden public and workflow guidance", async () => {
  const root = await temporaryRoot("tiny-chu-worker-plan-");
  const worker = createTinyChuPlugin({ root, mode: "worker" });
  const orchestratorWorker = createTinyChuPlugin({ root, mode: "orchestrator_worker" });
  const hiddenTools = new RegExp(WORKER_HIDDEN_TOOLS.join("|"));

  const workerPlan = await worker.tools.tool_usage_plan({
    objective: "analyze tiny-chu repository with opencode workflow and qwen retry recovery",
  });
  const workerRetry = await worker.tools.qwen_retry_policy({ status: "failed" });
  const orchestratorPlan = await orchestratorWorker.tools.tool_usage_plan({
    objective: "analyze tiny-chu repository with opencode workflow",
  });
  const workerGuidance = `${JSON.stringify(workerPlan)}\n${JSON.stringify(workerRetry)}`;

  assert.doesNotMatch(workerGuidance, hiddenTools);
  assert.doesNotMatch(workerGuidance, /public_retry|public_dispatch|public delegation|public limit|public queue|public Qwen/i);
  assert.match(JSON.stringify(orchestratorPlan), /analysis_workflow_start|workflow_next|workflow_sot_audit/);
});

test("worker mode health and OpenCode descriptions avoid public queue state and guidance", async () => {
  const root = await temporaryRoot("tiny-chu-worker-health-");
  const worker = createTinyChuPlugin({ root, mode: "worker" });
  const orchestratorWorker = createTinyChuPlugin({ root, mode: "orchestrator_worker" });
  const hooks = await TinyChuOpenCodePlugin(fakeOpenCodeInput(root), { mode: "worker" });
  const publicJobDir = path.join(root, ".tiny", "public-jobs");

  const health = await worker.tools.orchestration_health({});
  const publicJobState = await readdir(publicJobDir).catch((error) => error?.code === "ENOENT" ? "missing" : Promise.reject(error));
  const workerDescriptions = worker.registry.toolSpecs.map((spec) => spec.description).join("\n");
  const hookDescriptions = Object.values(hooks.tool).map((definition) => definition.description).join("\n");

  assert.equal(Object.hasOwn(health, "publicJobs"), false);
  assert.equal(publicJobState, "missing");
  assert.doesNotMatch(JSON.stringify(health), /\bpublic(?:Jobs|_retry| job| worker| queue)?\b/i);
  assert.doesNotMatch(workerDescriptions, /\bpublic\b/i);
  assert.doesNotMatch(hookDescriptions, /\bpublic\b/i);
  assert.match(orchestratorWorker.registry.toolSpecs.find((spec) => spec.name === "qwen_retry_policy")?.description ?? "", /\bpublic\b/i);
});

test("worker mode rejects dispatching packet optimizer and writes no public job state", async () => {
  const root = await temporaryRoot("tiny-chu-worker-dispatch-");
  const tiny = createTinyChuPlugin({ root, mode: "worker" });

  await assert.rejects(
    () => tiny.tools.worker_packet_optimizer({
      objective: "worker mode must stay packet-only",
      evidenceRefs: ["src/index.ts:1"],
      dispatch: true,
    }),
    /worker mode.*dispatch/i,
  );

  const jobs = await readdir(path.join(root, ".tiny", "public-jobs")).catch(() => []);
  assert.deepEqual(jobs, []);
});

test("worker mode construction does not rewrite existing workflow or public-job state", async () => {
  const root = await temporaryRoot("tiny-chu-worker-state-");
  const workflowDir = path.join(root, ".tiny", "workflows", "runs");
  const publicJobDir = path.join(root, ".tiny", "public-jobs");
  const workflowFile = path.join(workflowDir, "W-existing.json");
  const publicJobFile = path.join(publicJobDir, "J-existing.json");
  await mkdir(workflowDir, { recursive: true });
  await mkdir(publicJobDir, { recursive: true });
  await writeFile(workflowFile, JSON.stringify({ runId: "W-existing", status: "active" }), "utf8");
  await writeFile(publicJobFile, JSON.stringify({ id: "J-existing", status: "queued" }), "utf8");
  const before = {
    workflow: await stat(workflowFile),
    publicJob: await stat(publicJobFile),
  };

  const tiny = createTinyChuPlugin({ root, mode: 1 });
  await tiny.tools.tiny_chu_install_check({});

  const after = {
    workflow: await stat(workflowFile),
    publicJob: await stat(publicJobFile),
  };
  assert.equal(after.workflow.size, before.workflow.size);
  assert.equal(after.publicJob.size, before.publicJob.size);
  assert.equal(after.workflow.mtimeMs, before.workflow.mtimeMs);
  assert.equal(after.publicJob.mtimeMs, before.publicJob.mtimeMs);
});

test("docs show runtime mode selection through Tiny-Chu plugin options", async () => {
  const docs = [
    await readFile("README.md", "utf8"),
    await readFile("HOW_TO_USE.md", "utf8"),
    await readFile("INSTALL.md", "utf8"),
  ].join("\n");

  assert.match(docs, /"plugin":\s*\[\["tiny-chu",\s*\{\s*"mode":\s*1\s*\}\]\]/);
  assert.match(docs, /"plugin":\s*\[\["tiny-chu",\s*\{\s*"mode":\s*2\s*\}\]\]/);
  assert.match(docs, /TinyChuOpenCodePlugin\(input,\s*\{\s*\.\.\.options,\s*mode:\s*1\s*\}\)/);
  assert.match(docs, /createTinyChuPlugin\(\{\s*mode:\s*"worker"\s*\}\)/);
  assert.match(docs, /createTinyChuPlugin\(\{\s*mode:\s*"orchestrator_worker"\s*\}\)/);
  assert.match(docs, /default(?:s)? to mode 2|mode 2 is the default/i);
  assert.doesNotMatch(docs, /OpenCode['’]s top-level `mode` object[^.\n]*(?:use|set|configure)/i);
});
