import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
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
    "artifact_check",
    "api_backend_trace",
    "business_logic_map",
    "chunked_write_plan",
    "context_bundle",
    "context_digest",
    "evidence_qa",
    "integration_catalog",
    "legacy_repo_index",
    "mermaid_check",
    "mermaid_fix",
    "orchestration_profile",
    "orchestration_health",
    "public_cancel",
    "public_checkpoint",
    "public_collect",
    "public_dispatch",
    "public_retry",
    "qwen_retry_policy",
    "repo_map",
    "rules_snapshot",
    "task_checkpoint",
    "task_create",
    "task_get",
    "task_list",
    "task_update",
    "resume_packet",
    "traceability_matrix",
    "tool_usage_plan",
    "ui_action_trace",
    "wiki_bundle",
  ].sort());
  const env = {};
  await hooks["shell.env"]?.({ cwd: root }, { env });
  assert.equal(env.TINY_CHU_ROOT, root);
  assert.equal(env.TINY_CHU_OPENCODE_PLUGIN, "1");
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
