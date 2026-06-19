import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createSmallModelContributionEvaluation } from "../dist/index.js";
import { createPortableSymlink as symlink } from "./support/symlink.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "fixtures", "small-model-contribution");
const expectedRowIds = [
  "A01", "A02", "A03", "A04", "B05", "B06", "B07", "B08", "C09", "C10", "C11", "C12", "D13", "D14", "D15", "E16", "E17", "E18", "F19", "F20", "F21", "F22",
];

async function readFixture(name) {
  return JSON.parse(await readFile(path.join(fixtureDir, name), "utf8"));
}

function assertFixPaths(fixPaths) {
  assert.ok(fixPaths.length > 0);
  for (const fixPath of fixPaths) {
    assert.equal(typeof fixPath.tool, "string");
    assert.equal(typeof fixPath.nextCommand, "string");
  }
}

test("recovery-flow lost-work overload fails offline with evidence and checkpoint remediation", async () => {
  const healthy = await readFixture("healthy.json");
  const result = createSmallModelContributionEvaluation({
    ...healthy,
    fixtureId: "recovery-flow-lost-work-overload",
    contextBudget: { status: "split_required", maxContextTokens: 8192, usableInputTokens: 7168, promptChars: 15240 },
    toolUsagePlan: { status: "fail", visibleToolCount: 96, selectedPathLength: 12 },
    evidenceGate: { status: "fail", missingRequired: ["checkpoint-log", "recovery-evidence"], evidenceRefs: [] },
    resumePacket: { status: "fail", hasCheckpoint: false, hasNextSteps: false },
    qwenRetryPolicy: { status: "fail", checkpointBeforeRetry: false, minimumBatches: 0 },
    providerCall: { requested: false, provider: "offline-fixture-only" },
    rubricRows: healthy.rubricRows.map((row) => ["B05", "D13", "E17"].includes(row.id) ? { ...row, score: 0, evidenceRefs: [] } : row),
    loadObservations: [
      factor("file_write_too_large", 4200, 2000, "chunked_write_plan"),
      factor("missing_evidence_ref", 0, 1, "evidence_gate"),
      factor("missing_recovery_state", 0, 1, "task_checkpoint"),
      factor("prompt_over_budget", 15240, 12000, "context_packet"),
      factor("retry_policy_missing", 0, 1, "qwen_retry_policy"),
      factor("tool_surface_overload", 96, 88, "task_focus_packet"),
    ],
  });

  assert.equal(result.status, "fail");
  assert.equal(result.requestAttempted, false);
  assert.deepEqual(result.rows.map((row) => row.id), expectedRowIds);
  assertFixPaths(result.fixPaths);
  assert.equal(result.loadFactors.some((item) => item.kind === "provider_call"), false);
  assert.ok(result.loadFactors.some((item) => item.kind === "recovery"));
  assert.ok(result.loadFactors.some((item) => item.kind === "evidence"));
  assert.ok(result.diagnostics.some((item) => item.code === "missing_evidence_ref"));
  assert.deepEqual(new Set(result.fixPaths.map((item) => item.tool)), new Set([
    "chunked_write_plan",
    "context_packet",
    "evidence_gate",
    "qwen_retry_policy",
    "task_checkpoint",
    "task_focus_packet",
  ]));
});

test("required row ids fail closed without evidence even when fixture marks them optional", async () => {
  const healthy = await readFixture("healthy.json");
  const result = createSmallModelContributionEvaluation({
    ...healthy,
    rubricRows: healthy.rubricRows.map((row) => ({ ...row, required: false, evidenceRefs: [] })),
  });

  assert.equal(result.status, "fail");
  assert.equal(result.requestAttempted, false);
  assert.equal(result.normalizedScore, 80);
  assert.ok(result.diagnostics.some((item) => item.code === "missing_evidence_ref" && item.rowId === "A01"));
});

test("explicit load observations do not suppress synthesized overload factors", async () => {
  const healthy = await readFixture("healthy.json");
  const result = createSmallModelContributionEvaluation({
    ...healthy,
    contextBudget: { status: "split_required", promptChars: 7000 },
    toolUsagePlan: { visibleToolCount: 41, selectedPathLength: 9 },
    resumePacket: { hasCheckpoint: false, hasNextSteps: false },
    qwenRetryPolicy: { checkpointBeforeRetry: false },
    loadObservations: [factor("stale_context", 1, 0, "incremental_evidence_cache", "warning")],
  });

  assert.equal(result.status, "fail");
  assert.ok(result.loadFactors.some((item) => item.factorId === "context_split_required"));
  assert.ok(result.loadFactors.some((item) => item.factorId === "missing_recovery_state"));
  assert.ok(result.loadFactors.some((item) => item.factorId === "retry_policy_missing"));
  assert.ok(result.loadFactors.some((item) => item.factorId === "prompt_over_budget" && item.severity === "warning" && item.threshold === 6000));
  assert.ok(result.loadFactors.some((item) => item.factorId === "tool_surface_overload" && item.severity === "warning" && item.threshold === 40));
});

test("explicit same-factor warnings cannot downgrade synthesized failures", async () => {
  const healthy = await readFixture("healthy.json");
  const result = createSmallModelContributionEvaluation({
    ...healthy,
    contextBudget: { status: "fit", promptChars: 15240 },
    toolUsagePlan: { visibleToolCount: 96, selectedPathLength: 7 },
    loadObservations: [
      factor("prompt_over_budget", 7000, 6000, "context_packet", "warning"),
      factor("tool_surface_overload", 41, 40, "tool_usage_plan", "warning"),
    ],
  });

  assert.equal(result.status, "fail");
  assert.ok(result.loadFactors.some((item) => item.factorId === "prompt_over_budget" && item.severity === "fail" && item.threshold === 12000));
  assert.ok(result.loadFactors.some((item) => item.factorId === "tool_surface_overload" && item.severity === "fail" && item.threshold === 88));
});

test("CLI rejects symlinked output directories before writing outside root", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-contribution-cli-"));
  const outsideDir = path.join(tempRoot, "outside");
  const outsideNested = path.join(outsideDir, "nested");
  const outsideFile = path.join(outsideNested, "leak.json");
  const linkPath = path.join(process.cwd(), ".omo", "evidence", "symlink-output-guard-test");
  await mkdir(outsideDir, { recursive: true });
  await rm(linkPath, { recursive: true, force: true });
  await symlink(outsideDir, linkPath, "dir");

  try {
    const result = spawnSync(process.execPath, [
      "scripts/evaluate-small-model-contribution.mjs",
      "--fixture",
      path.join("test", "fixtures", "small-model-contribution", "healthy.json"),
      "--out",
      path.join(".omo", "evidence", "symlink-output-guard-test", "nested", "leak.json"),
    ], { cwd: process.cwd(), encoding: "utf8" });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /outside the repository root/);
    await assert.rejects(readFile(outsideNested, "utf8"), { code: "ENOENT" });
    await assert.rejects(readFile(outsideFile, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(linkPath, { recursive: true, force: true });
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function factor(factorId, measured, threshold, tool, severity = "fail") {
  return {
    factorId,
    severity,
    measured,
    threshold,
    blockedReason: `${factorId} blocks reliable small-model recovery.`,
    fixPaths: [{ tool, nextCommand: `run ${tool} before retrying` }],
  };
}
