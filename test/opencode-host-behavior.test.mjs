import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTinyChuPlugin } from "../dist/index.js";
import { TinyChuOpenCodePlugin } from "../dist/opencode/plugin.js";

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function visiblePlanTools(plan) {
  return plan.steps.flatMap((step) => [step.tinyTool, step.nativeTool].filter(Boolean));
}

async function publicJobCount(root) {
  const files = await readdir(path.join(root, ".tiny", "public-jobs")).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return files.filter((file) => file.endsWith(".json")).length;
}

test("OpenCode host budgets output without wrapping the direct library tool", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-opencode-host-budget-"));
  const hooks = await TinyChuOpenCodePlugin({
    project: { root },
    directory: root,
    worktree: root,
    client: { app: { log: async () => undefined } },
    $: async () => undefined,
  });
  const direct = await createTinyChuPlugin({ root }).tools.orchestration_profile({
    maxOutputChars: 1200,
    maxArrayItems: 2,
  });
  const bridged = await hooks.tool.orchestration_profile.execute(
    { input: { maxOutputChars: 1200, maxArrayItems: 2 } },
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

  assert.equal(typeof direct, "object");
  assert.equal(hasOwn(direct, "title"), false);
  assert.equal(hasOwn(direct, "output"), false);
  assert.equal(hasOwn(direct, "metadata"), false);
  assert.ok(direct.smallContextRun ?? direct.operatingModes?.smallContextRun);
  assert.equal(bridged.metadata.truncated, true);
  assert.ok(bridged.output.length <= 1200);
});

test("OpenCode chat hook includes host context markers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-opencode-host-message-"));
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
  const transformed = output.parts[0].text;

  assert.match(transformed, /tiny-chu-context/);
  assert.match(transformed, /tiny-chu-small-context/);
  assert.match(transformed, /tiny-chu-powershell-tooling/);
  assert.match(transformed, /profileMode: compact/);
  assert.doesNotMatch(transformed, /## Artifact contracts/);
  assert.ok(transformed.length < 6000);
});

test("explicit packet-only dispatch remains queue-free after default packet optimization", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-opencode-host-packet-"));
  const plugin = createTinyChuPlugin({ root });

  await plugin.tools.worker_packet_optimizer({
    objective: "Analyze order flow without queueing public work",
    evidenceRefs: ["src/ui/OrderPage.jsx:2", "src/api/orderClient.js:3"],
  });
  const beforeExplicitPacketJobs = await publicJobCount(root);
  const explicitPacketOnly = await plugin.tools.worker_packet_optimizer({
    objective: "Analyze order flow without queueing public work",
    evidenceRefs: ["src/ui/OrderPage.jsx:2", "src/api/orderClient.js:3"],
    dispatch: false,
  });

  assert.equal(await publicJobCount(root), beforeExplicitPacketJobs);
  assert.equal(beforeExplicitPacketJobs, 0);
  assert.equal(explicitPacketOnly.dispatchMode, "packet_only");
  assert.equal(explicitPacketOnly.dispatch.requested, false);
});

test("tool usage plans stay bounded for legacy, Mermaid, and UX host tasks", async () => {
  const plugin = createTinyChuPlugin();
  const cases = [
    {
      label: "legacy",
      input: {
        objective: "trace UI button through saga API backend MyBatis RFC and produce evidence",
        artifactType: "flowchart",
      },
      expectedTools: ["legacy_repo_index", "traceability_matrix", "evidence_qa"],
    },
    {
      label: "mermaid",
      input: {
        objective: "produce a Mermaid sequence diagram from existing notes",
        artifactType: "sequence_diagram",
      },
      expectedTools: ["artifact_format_template", "mermaid_check", "artifact_check"],
    },
    {
      label: "ux",
      input: {
        objective: "reverse engineer screen UX layout rationale",
        artifactType: "ux_reverse_analysis",
      },
      expectedTools: ["ui_layout_catalog", "ux_rationale_trace", "ux_reverse_report"],
    },
  ];

  for (const item of cases) {
    const plan = await plugin.tools.tool_usage_plan(item.input);
    const tools = visiblePlanTools(plan);
    assert.ok(plan.steps.length <= 8, `${item.label} plan exceeded the small-model step cap`);
    assert.equal(plan.verification.requiredAfterWork, true);
    for (const expectedTool of item.expectedTools) {
      assert.ok(tools.includes(expectedTool), `${item.label} plan omitted ${expectedTool}`);
    }
  }
});
