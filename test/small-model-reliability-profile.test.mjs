import assert from "node:assert/strict";
import test from "node:test";
import { createTinyChuPlugin } from "../dist/index.js";

test("standard and strict profiles block context split before worker dispatch", async () => {
  const tiny = createTinyChuPlugin();

  const standard = await tiny.tools.context_budget_simulation({
    profileId: "standard",
    maxContextTokens: 128,
    reservedOutputTokens: 64,
    packets: [{ name: "large packet", estimatedTokens: 1000 }],
  });
  const strict = await tiny.tools.context_budget_simulation({
    profileId: "strict",
    maxContextTokens: 128,
    reservedOutputTokens: 64,
    packets: [{ name: "large packet", estimatedTokens: 1000 }],
  });

  assert.equal(standard.status, "split_required");
  assert.equal(strict.status, "split_required");
  assert.ok(standard.diagnostics.some((diagnostic) => diagnostic.code === "quality_profile_context_split_blocked"));
  assert.ok(strict.diagnostics.some((diagnostic) => diagnostic.code === "quality_profile_context_split_blocked"));
  assert.deepEqual(standard.nextToolCalls.map((call) => call.tool), ["context_budget_simulation", "worker_packet_optimizer"]);
  assert.deepEqual(strict.nextToolCalls.map((call) => call.tool), ["context_budget_simulation", "worker_packet_optimizer"]);
});

test("strict profile turns conformance replay and claim failures into deterministic next calls", async () => {
  const tiny = createTinyChuPlugin();

  const conformance = await tiny.tools.tool_call_conformance_probe({
    profileId: "strict",
    allowedTools: ["context_bundle"],
    fixture: { content: "I will call context_bundle later." },
  });
  const replay = await tiny.tools.small_model_replay({
    profileId: "strict",
    cases: [{ name: "unsupported claim", expected: "claim_evidence_check", actual: "claim_evidence_check", evidenceRefs: [] }],
  });

  assert.equal(conformance.status, "fail");
  assert.deepEqual(conformance.nextToolCalls.map((call) => call.tool), ["tool_call_conformance_probe"]);
  assert.equal(replay.status, "fail");
  assert.deepEqual(replay.nextToolCalls.map((call) => call.tool), ["small_model_replay", "claim_evidence_check"]);
});
