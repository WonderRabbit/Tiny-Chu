import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultAgentModelTemplates, createTinyChuPlugin, recommendModelOptionControls, validateAgentModelTemplate } from "../dist/index.js";
import { TinyChuOpenCodePlugin } from "../dist/opencode/plugin.js";

test("agent model option templates expose all roles and validate defaults", async () => {
  const templates = createDefaultAgentModelTemplates();
  assert.deepEqual(Object.keys(templates).sort(), [
    "delegate",
    "fact_researcher",
    "foreman",
    "implementation_worker",
    "qa_runner",
    "reviewer",
    "ui_ux_analyst",
    "wireframe_planner",
  ]);
  for (const template of Object.values(templates)) {
    assert.equal(validateAgentModelTemplate(template).valid, true, template.agentKind);
  }
  const profile = await createTinyChuPlugin().tools.orchestration_profile({});
  assert.deepEqual(Object.keys(profile.agentTemplates).sort(), Object.keys(templates).sort());
});

test("agent model validation rejects unsupported provider options", () => {
  const openai = validateAgentModelTemplate({
    agentKind: "fact_researcher",
    modelRef: { provider: "openai-responses", model: "gpt-5.1" },
    generation: { sampling: { topK: 10 } },
    capabilities: ["fact_research"],
    validationRules: ["no live provider API calls"],
  });
  assert.equal(openai.valid, false);
  assert.ok(openai.diagnostics.some((diagnostic) => diagnostic.fieldPath === "generation.sampling.topK"));

  const anthropic = validateAgentModelTemplate({
    agentKind: "delegate",
    modelRef: { provider: "anthropic-messages", model: "claude-opus-4-8" },
    generation: { sampling: { temperature: 0.2, topP: 0.8, topK: 20 }, reasoning: { openaiEffort: "high" } },
    capabilities: ["implementation"],
    validationRules: ["no live provider API calls"],
  });
  assert.equal(anthropic.valid, false);
  assert.ok(anthropic.diagnostics.some((diagnostic) => diagnostic.action === "reject" || diagnostic.action === "omit"));
});

test("model option control recommendations are data-only", () => {
  const slider = recommendModelOptionControls({ field: "sampling.temperature", kind: "number", min: 0, max: 1, step: 0.1 });
  assert.ok(["number_input", "slider"].includes(slider.control));
  assert.equal("component" in slider, false);

  const disabled = recommendModelOptionControls({ field: "sampling.topK", kind: "number", capability: { supported: false, reason: "unsupported" } });
  assert.ok(["disabled", "hidden"].includes(disabled.control));
  assert.match(disabled.diagnostic ?? "", /unsupported/);
});

test("tool usage plan recommends agent templates and OpenCode budgets profile output", async () => {
  const plugin = createTinyChuPlugin();
  const plan = await plugin.tools.tool_usage_plan({ objective: "listen to changes and plan wireframe validation controls" });
  assert.equal(plan.agentKind, "wireframe_planner");
  assert.ok(plan.modelOptionValidation.valid);
  assert.ok(plan.steps.length <= 8);
  assert.ok(plan.verification.requiredTools.includes("task_checkpoint"));

  const root = process.cwd();
  const hooks = await TinyChuOpenCodePlugin({
    project: { root },
    directory: root,
    worktree: root,
    client: { app: { log: async () => undefined } },
    $: async () => undefined,
  });
  const result = await hooks.tool.orchestration_profile.execute(
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
  assert.equal(result.metadata.truncated, true);
  assert.match(result.output, /agentTemplates|omittedItems/);
});
