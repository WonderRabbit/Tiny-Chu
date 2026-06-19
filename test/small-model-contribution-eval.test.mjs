import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createSmallModelContributionEvaluation } from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "fixtures", "small-model-contribution");

const expectedRowIds = [
  "A01", "A02", "A03", "A04", "B05", "B06", "B07", "B08", "C09", "C10", "C11", "C12", "D13", "D14", "D15", "E16", "E17", "E18", "F19", "F20", "F21", "F22",
];

async function readFixture(name) {
  return JSON.parse(await readFile(path.join(fixtureDir, name), "utf8"));
}

function sortedCopy(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function assertSorted(values, label) {
  assert.deepEqual(values, sortedCopy(values), `${label} must be sorted`);
}

function assertFixPaths(fixPaths) {
  assert.ok(fixPaths.length > 0);
  for (const fixPath of fixPaths) {
    assert.equal(typeof fixPath.tool, "string");
    assert.ok(fixPath.tool.length > 0);
    assert.equal(typeof fixPath.nextCommand, "string");
    assert.ok(fixPath.nextCommand.length > 0);
  }
}

test("healthy fixture produces a deterministic contribution score contract", async () => {
  const input = await readFixture("healthy.json");

  assert.deepEqual(Object.keys(input.docsOnlyProof.individualGateOutputs).sort(), [
    "contextBudget",
    "evidenceGate",
    "qwenRetryPolicy",
    "resumePacket",
    "smallModelReplay",
    "toolCallConformance",
    "toolUsagePlan",
    "workflowSotAudit",
  ]);
  assert.equal(input.docsOnlyProof.hasSingleNormalizedContributionScore, false);
  for (const aggregateField of ["rawScore", "maxScore", "normalizedScore", "scoreBand", "blockedReasons", "fixPaths"]) {
    assert.equal(Object.hasOwn(input, aggregateField), false, `${aggregateField} must come from the evaluator`);
  }

  const result = createSmallModelContributionEvaluation(input);

  assert.equal(result.status, "pass");
  assert.equal(result.requestAttempted, false);
  assert.equal(result.rawScore, 35);
  assert.equal(result.maxScore, 44);
  assert.equal(result.normalizedScore, 80);
  assert.equal(result.scoreBand, "infrastructure_help");
  assert.equal(result.rows.length, 22);
  assert.deepEqual(result.rows.map((row) => row.id), expectedRowIds);
  assertSorted(result.rows.map((row) => `${row.category}:${row.id}`), "rows");
  assert.deepEqual(result.loadFactors, []);
  assert.deepEqual(result.blockedReasons, []);
  assert.deepEqual(result.fixPaths, []);
  assert.deepEqual(result.diagnostics, []);
});

test("load-risk fixture reports sorted load factors, blocked reasons, and fix paths", async () => {
  const result = createSmallModelContributionEvaluation(await readFixture("load-risk.json"));

  assert.equal(result.status, "fail");
  assert.equal(result.requestAttempted, false);
  assert.equal(result.rawScore, 13);
  assert.equal(result.maxScore, 44);
  assert.equal(result.normalizedScore, 30);
  assert.equal(result.scoreBand, "weak_scaffold");
  assert.deepEqual(result.rows.map((row) => row.id), expectedRowIds);
  assertSorted(result.rows.map((row) => `${row.category}:${row.id}`), "rows");

  const factorKeys = result.loadFactors.map((factor) => `${factor.severity}:${factor.factorId}`);
  assertSorted(factorKeys, "load factors");
  assert.deepEqual(new Set(result.loadFactors.map((factor) => factor.kind)), new Set([
    "command",
    "context",
    "evidence",
    "file_write",
    "provider_call",
    "prompt",
    "recovery",
    "tool",
  ]));
  assert.ok(result.loadFactors.every((factor) => typeof factor.blockedReason === "string" && factor.blockedReason.length > 0));
  assert.ok(result.blockedReasons.length >= 7);
  assertFixPaths(result.fixPaths);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "provider_call_forbidden"));
});

test("malformed fixture rejects duplicate rubric rows", async () => {
  const result = createSmallModelContributionEvaluation(await readFixture("malformed-duplicate-row.json"));

  assert.equal(result.status, "fail");
  assert.equal(result.requestAttempted, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "duplicate_row_id" && diagnostic.rowId === "A01"));
});

test("malformed fixture rejects unknown load factors", async () => {
  const result = createSmallModelContributionEvaluation(await readFixture("malformed-unknown-factor.json"));

  assert.equal(result.status, "fail");
  assert.equal(result.requestAttempted, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown_load_factor"));
});

test("provider-call attempts are reported without making a request", async () => {
  const result = createSmallModelContributionEvaluation(await readFixture("provider-attempt.json"));

  assert.equal(result.status, "fail");
  assert.equal(result.requestAttempted, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "provider_call_forbidden"));
  assert.ok(result.loadFactors.some((factor) => factor.kind === "provider_call"));
  assert.ok(result.blockedReasons.some((reason) => reason.includes("provider")));
  assertFixPaths(result.fixPaths);
});
