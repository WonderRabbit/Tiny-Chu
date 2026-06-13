import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTinyInfiPlugin } from "../dist/index.js";
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
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-infi-opencode-"));
  const hooks = await TinyChuOpenCodePlugin({
    project: { root },
    directory: root,
    worktree: root,
    client: { app: { log: async () => undefined } },
    $: async () => undefined,
  });
  assert.ok(hooks.tool);
  assert.deepEqual(Object.keys(hooks.tool).sort(), [
    "aggregation_drift_check",
    "artifact_check",
    "artifact_format_template",
    "api_backend_trace",
    "api_contract_catalog",
    "atomic_markdown_write",
    "business_logic_map",
    "button_trace_aggregate",
    "button_worker_packet",
    "button_worker_result_check",
    "button_workflow_dispatch",
    "button_workflow_done_claim",
    "button_workflow_plan",
    "chunked_write_plan",
    "claim_evidence_check",
    "context_bundle",
    "context_packet",
    "context_digest",
    "doctor",
    "dto_schema_map",
    "environment_doctor",
    "error_transaction_map",
    "evidence_qa",
    "evidence_snapshot",
    "artifact_pack_manifest",
    "auth_permission_trace",
    "incremental_evidence_cache",
    "integration_catalog",
    "layout_truth_report",
    "layout_truth_update",
    "layout_truth_verify",
    "legacy_repo_index",
    "mermaid_check",
    "mermaid_fix",
    "markdown_envelope_check",
    "orchestration_profile",
    "powershell_command_guard",
    "orchestration_health",
    "public_cancel",
    "public_checkpoint",
    "public_collect",
    "public_complete",
    "public_dispatch",
    "public_retry",
    "qwen_retry_policy",
    "redux_state_flow_map",
    "repo_map",
    "rules_snapshot",
    "session_preflight",
    "task_checkpoint",
    "task_create",
    "task_get",
    "task_list",
    "task_update",
    "task_focus_packet",
    "resume_packet",
    "test_impact_planner",
    "tiny_chu_install_check",
    "trace_diagram_render",
    "traceability_matrix",
    "tool_usage_plan",
    "ui_layout_catalog",
    "ui_action_trace",
    "ux_rationale_trace",
    "ux_reverse_report",
    "ux_validation_matrix",
    "wiki_bundle",
    "write_loop_guard",
    "worker_packet_optimizer",
  ].sort());
  const tiny = createTinyInfiPlugin({ root });
  const install = await tiny.tools.tiny_chu_install_check({});
  const registeredToolNames = Object.keys(tiny.tools).sort();
  const openCodeToolNames = Object.keys(hooks.tool).sort();
  assert.deepEqual(install.requiredTools, registeredToolNames);
  assert.deepEqual(install.requiredTools, openCodeToolNames);
  for (const name of [
    "layout_truth_report",
    "layout_truth_update",
    "layout_truth_verify",
    "ui_layout_catalog",
    "ux_rationale_trace",
    "ux_reverse_report",
    "ux_validation_matrix",
    "doctor",
    "artifact_format_template",
    "context_packet",
    "task_focus_packet",
    "public_complete",
    "button_workflow_plan",
  ]) {
    assert.ok(install.requiredTools.includes(name), `${name} must be reported by tiny_chu_install_check`);
  }
  const env = {};
  await hooks["shell.env"]?.({ cwd: root }, { env });
  assert.equal(env.TINY_CHU_ROOT, root);
  assert.equal(env.TINY_CHU_OPENCODE_PLUGIN, "1");
});

test("OpenCode tool output is budgeted without changing the library tool contract", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-infi-opencode-budget-"));
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
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-infi-small-context-smoke-"));
  const tiny = createTinyInfiPlugin({ root });

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
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-infi-opencode-chat-"));
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
  assert.match(output.parts[0].text, /tiny-infi-context/);
  assert.match(output.parts[0].text, /tiny-infi-small-context/);
  assert.match(output.parts[0].text, /tiny-infi-powershell-tooling/);
});

test("compaction includes Tiny-Chu focus packet", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-infi-opencode-compaction-"));
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
