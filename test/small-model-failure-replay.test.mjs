import assert from "node:assert/strict";
import test from "node:test";
import { createTinyChuPlugin } from "../dist/index.js";

function toolNames(plan) {
  return plan.steps.map((step) => step.tinyTool).filter((tool) => typeof tool === "string");
}

test("small-model routine preserves the deterministic recovery sequence", async () => {
  // Given: a small-context correction task after a model drift event.
  const tiny = createTinyChuPlugin({ root: process.cwd() });

  // When: the foreman asks for the next tool sequence.
  const plan = await tiny.tools.tool_usage_plan({
    objective: "correct a small-context operating-mode breach after a live provider call was suggested",
  });

  // Then: the sequence keeps the bounded context and checkpoint gates in order.
  assert.deepEqual(toolNames(plan), [
    "doctor",
    "session_preflight",
    "context_packet",
    "incremental_evidence_cache",
    "tool_usage_plan",
    "worker_packet_optimizer",
    "qwen_retry_policy",
    "task_checkpoint",
  ]);
  assert.ok(plan.stopRules.some((rule) => /no live provider calls/i.test(rule)));
  assert.ok(plan.verification.requiredTools.includes("claim_evidence_check"));
  assert.ok(plan.verification.requiredTools.includes("task_checkpoint"));
});

test("small-model failure replay covers hallucination and unsupported tool calls", async () => {
  // Given: deterministic fixtures for unsupported claims and malformed tool-call output.
  const tiny = createTinyChuPlugin({ root: process.cwd() });

  // When: replay and conformance gates evaluate the fixtures.
  const replay = await tiny.tools.small_model_replay({
    profileId: "strict",
    cases: [
      {
        name: "hallucinated business file",
        expected: "context_digest",
        actual: "src/ghost-business-rule.ts",
        evidenceRefs: [],
      },
      {
        name: "cited context digest",
        expected: "context_digest",
        actual: "context_digest",
        evidenceRefs: ["src/opencode/small-model-reliability.ts:1"],
      },
    ],
  });
  const conformance = await tiny.tools.tool_call_conformance_probe({
    profileId: "strict",
    allowedTools: ["context_digest"],
    fixture: {
      tool_calls: [
        {
          id: "bad_tool",
          type: "function",
          function: { name: "provider_chat_generate", arguments: "{\"prompt\":\"hello\"}" },
        },
      ],
    },
  });

  // Then: unsupported output fails closed with next remediation tools instead of live provider calls.
  assert.equal(replay.status, "fail");
  assert.equal(replay.failedCases, 1);
  assert.ok(replay.cases.some((item) => item.diagnostics.some((diagnostic) => diagnostic.code === "missing_evidence_ref")));
  assert.deepEqual(replay.nextToolCalls.map((call) => call.tool), ["small_model_replay", "claim_evidence_check"]);
  assert.equal(conformance.status, "fail");
  assert.equal(conformance.requestAttempted, false);
  assert.ok(conformance.diagnostics.some((diagnostic) => diagnostic.code === "invalid_tool_arguments"));
  assert.deepEqual(conformance.nextToolCalls.map((call) => call.tool), ["tool_call_conformance_probe"]);
});

test("context overflow, long output, and worker retry failures route through bounded tools", async () => {
  // Given: oversized packets and long Markdown output that should not be handled in one model response.
  const tiny = createTinyChuPlugin({ root: process.cwd() });
  const budget = await tiny.tools.context_budget_simulation({
    profileId: "strict",
    maxContextTokens: 128,
    reservedOutputTokens: 64,
    packets: [{ name: "oversized", estimatedTokens: 1000 }],
  });
  const chunkPlan = await tiny.tools.chunked_write_plan({
    path: ".tiny/reports/long.md",
    markdown: `${"section\n".repeat(600)}`,
    maxChunkChars: 256,
  });
  const retry = await tiny.tools.qwen_retry_policy({
    status: "rate_limited",
    estimatedTokens: 45_000,
    attempt: 2,
  });
  const packets = await tiny.tools.worker_packet_optimizer({
    objective: "analyze qwen worker failure without dispatching live provider calls",
    evidenceRefs: ["README.md:1"],
    dispatch: false,
  });

  // When: each guard returns its observable recovery contract.
  // Then: the model is forced to split, chunk, checkpoint, and retry bounded packets only.
  assert.equal(budget.status, "split_required");
  assert.ok(budget.diagnostics.some((diagnostic) => diagnostic.code === "quality_profile_context_split_blocked"));
  assert.deepEqual(budget.nextToolCalls.map((call) => call.tool), ["context_budget_simulation", "worker_packet_optimizer"]);
  assert.ok(chunkPlan.chunks.length > 1);
  assert.equal(chunkPlan.chunks.map((chunk) => chunk.text).join(""), "section\n".repeat(600));
  assert.equal(retry.shouldRetry, true);
  assert.ok(retry.recoveryProtocol.some((step) => /task_checkpoint/.test(step)));
  assert.equal(packets.noLiveProviderCalls, true);
  assert.equal(packets.dispatchMode, "packet_only");
  assert.deepEqual(packets.dispatch.publicJobIds, []);
});
