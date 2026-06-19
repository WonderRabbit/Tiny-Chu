import assert from "node:assert/strict";
import test from "node:test";
import { createTinyChuPlugin } from "../dist/index.js";

test("orchestration_profile resolves quick standard and strict quality profiles", async () => {
  const tiny = createTinyChuPlugin();

  const quick = await tiny.tools.orchestration_profile({ profileId: "quick" });
  const standard = await tiny.tools.orchestration_profile({ profileId: "standard" });
  const strict = await tiny.tools.orchestration_profile({ profileId: "strict" });

  assert.equal(quick.qualityProfile.id, "quick");
  assert.equal(standard.qualityProfile.id, "standard");
  assert.equal(strict.qualityProfile.id, "strict");
  assert.deepEqual(
    strict.qualityProfile.requiredChecks,
    [
      "build",
      "test",
      "evidence_gate",
      "workflow_sot_audit",
      "tool_call_conformance_probe",
      "context_budget_simulation",
      "small_model_replay",
      "claim_evidence_check",
    ],
  );
  assert.equal(strict.qualityProfile.runDiagnosticsAdvisory, true);
  assert.equal(strict.qualityProfile.evidenceFreshness.staleEvidence, "fail");
  assert.equal(strict.qualityProfile.contextBudget.splitRequired, "block");
  assert.ok(strict.qualityProfile.nextToolCalls.every((call) => call.tool !== "run_diagnostics" || call.advisory === true));
});

test("evidence_gate applies profile required checks and strict stale evidence rejection", async () => {
  const tiny = createTinyChuPlugin();

  const standard = await tiny.tools.evidence_gate({
    profileId: "standard",
    checks: [
      { name: "build", status: "pass", evidenceRef: ".omo/evidence/build.txt" },
      { name: "test", status: "pass", evidenceRef: ".omo/evidence/test.txt" },
      { name: "evidence_gate", status: "pass", evidenceRef: ".omo/evidence/gate.txt" },
      { name: "workflow_sot_audit", status: "pass", evidenceRef: ".omo/evidence/sot.txt" },
      { name: "context_budget_simulation", status: "pass", evidenceRef: ".omo/evidence/budget.txt" },
    ],
  });
  assert.equal(standard.status, "pass");
  assert.equal(standard.profile.id, "standard");
  assert.deepEqual(standard.missingRequired, []);

  const strict = await tiny.tools.evidence_gate({
    profileId: "strict",
    checks: [
      { name: "build", status: "pass", evidenceRef: ".omo/evidence/build.txt", freshness: "stale" },
      { name: "test", status: "pass", evidenceRef: ".omo/evidence/test.txt" },
      { name: "evidence_gate", status: "pass", evidenceRef: ".omo/evidence/gate.txt" },
      { name: "workflow_sot_audit", status: "pass", evidenceRef: ".omo/evidence/sot.txt" },
      { name: "tool_call_conformance_probe", status: "pass", evidenceRef: ".omo/evidence/conformance.txt" },
      { name: "context_budget_simulation", status: "pass", evidenceRef: ".omo/evidence/budget.txt" },
      { name: "small_model_replay", status: "pass", evidenceRef: ".omo/evidence/replay.txt" },
      { name: "claim_evidence_check", status: "pass", evidenceRef: ".omo/evidence/claim.txt" },
    ],
  });
  assert.equal(strict.status, "fail");
  assert.ok(strict.diagnostics.some((diagnostic) => diagnostic.code === "stale_evidence_rejected"));
  assert.deepEqual(strict.nextToolCalls.map((call) => call.tool), ["evidence_snapshot", "evidence_gate"]);
});

test("malformed profile inputs fail closed with deterministic remediation", async () => {
  const tiny = createTinyChuPlugin();

  const unknownProfile = await tiny.tools.evidence_gate({ profileId: "deep", required: ["build"], checks: [] });

  assert.equal(unknownProfile.status, "fail");
  assert.ok(unknownProfile.diagnostics.some((diagnostic) => diagnostic.code === "unknown_quality_profile"));
  assert.deepEqual(unknownProfile.nextToolCalls, [
    {
      tool: "orchestration_profile",
      input: { profileId: "standard" },
      reason: "Resolve a supported quality profile before re-running evidence_gate.",
      advisory: false,
    },
  ]);
});
