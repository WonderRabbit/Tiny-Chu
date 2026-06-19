import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTinyChuPlugin } from "../dist/index.js";

async function temporaryRoot(t, prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function planReviewGate(plugin) {
  const value = plugin.tools.plan_review_gate;
  assert.equal(typeof value, "function", "plan_review_gate tool missing from createTinyChuPlugin().tools");
  return value;
}

function completePlanArtifact(overrides = {}) {
  return {
    objective: "Implement deterministic plan review gate",
    scopePaths: ["src/opencode/plan-review-gate.ts", "test/plan-review-gate.test.mjs"],
    todos: [
      { id: "T1", title: "Write failing test" },
      { id: "T2", title: "Implement gate" },
    ],
    evidenceRequirements: [
      ".omo/evidence/task-6-tiny-chu-docs-implementation-red.txt",
      ".omo/evidence/task-6-tiny-chu-docs-implementation-green.txt",
    ],
    qaCommands: ["npm run build", "node --test test/plan-review-gate.test.mjs"],
    stopConditions: ["all findings resolved", "manual QA evidence recorded"],
    sourceOfTruthRefs: ["AGENTS.md", ".omo/plans/tiny-chu-docs-implementation.md"],
    ...overrides,
  };
}

async function fileHash(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function publicJobCount(root) {
  const dir = path.join(root, ".tiny", "public-jobs");
  return readdir(dir).then((files) => files.filter((file) => file.endsWith(".json")).length, () => 0);
}

function completeMarkdownPlan() {
  return [
    "# Deterministic Markdown plan",
    "",
    "## Goal",
    "Implement deterministic plan review gate for Markdown artifacts.",
    "",
    "## Source of Truth",
    "- AGENTS.md",
    "- .omo/plans/tiny-chu-docs-implementation.md",
    "",
    "## Scope",
    "- src/opencode/plan-review-gate.ts",
    "- test/plan-review-gate.test.mjs",
    "",
    "## TODOs",
    "- [ ] T1. Write failing test",
    "- [ ] T2. Implement Markdown plan parsing",
    "",
    "## Evidence",
    "- [ ] E1. .omo/evidence/global-review-debug-red.txt",
    "- [ ] E2. .omo/evidence/global-review-debug-green.txt",
    "",
    "## Verification",
    "- npm run build",
    "- node --test test/plan-review-gate.test.mjs",
    "",
    "## Stop Conditions",
    "- all findings resolved",
    "- manual QA evidence recorded",
    "",
  ].join("\n");
}

function buttonPlanArtifact(overrides = {}) {
  return completePlanArtifact({
    objective: "Dispatch one verified button worker",
    scopePaths: ["src/Page.jsx"],
    workItems: [
      { buttonId: "save", file: "src/Page.jsx", line: 1, label: "Save", handler: "save", evidenceRefs: ["src/Page.jsx:1"] },
    ],
    ...overrides,
  });
}

test("plan_review_gate accepts a complete supplied plan artifact", async (t) => {
  const root = await temporaryRoot(t, "tiny-chu-plan-gate-accept-");
  const plugin = createTinyChuPlugin({ root });
  const gate = planReviewGate(plugin);

  const result = await gate(completePlanArtifact());

  assert.equal(result.accepted, true);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.remediationToolCalls, []);
});

test("plan_review_gate rejects missing QA, evidence, stop conditions, and source-of-truth refs", async (t) => {
  const root = await temporaryRoot(t, "tiny-chu-plan-gate-reject-");
  const plugin = createTinyChuPlugin({ root });
  const gate = planReviewGate(plugin);

  const result = await gate({
    objective: "x",
    todos: [],
  });
  const codes = result.findings.map((finding) => finding.code).sort();

  assert.equal(result.accepted, false);
  assert.deepEqual(codes, [
    "missing_evidence_requirements",
    "missing_qa_commands",
    "missing_scope",
    "missing_source_of_truth_refs",
    "missing_stop_conditions",
    "missing_todos_or_nodes",
    "objective_too_short",
  ]);
  assert.ok(result.findings.every((finding) => Array.isArray(finding.remediationToolCalls)));
  assert.ok(result.remediationToolCalls.some((call) => call.tool === "tool_usage_plan"));
  assert.ok(result.remediationToolCalls.some((call) => call.tool === "evidence_gate"));
});

test("plan_review_gate validates supplied artifact data instead of stale workflow state and does not mutate JSON", async (t) => {
  const root = await temporaryRoot(t, "tiny-chu-plan-gate-stale-");
  const plugin = createTinyChuPlugin({ root });
  const created = await plugin.tools.workflow_create({
    workflowId: "analysis",
    objective: "Workflow state has a valid objective",
    targetPath: ".",
    nodes: [{ nodeId: "collect", title: "Collect evidence" }],
  });
  const statePath = path.join(root, created.stateRef);
  const before = await fileHash(statePath);
  const gate = planReviewGate(plugin);

  const result = await gate({
    runId: created.runId,
    objective: "x",
    todos: [],
  });

  assert.equal(result.accepted, false);
  assert.ok(result.findings.some((finding) => finding.code === "missing_evidence_requirements"));
  assert.equal(await fileHash(statePath), before);
});

test("plan_review_gate validates planRef artifacts safely inside root", async (t) => {
  const root = await temporaryRoot(t, "tiny-chu-plan-gate-ref-");
  const plugin = createTinyChuPlugin({ root });
  const gate = planReviewGate(plugin);
  await writeFile(path.join(root, "complete-plan.json"), JSON.stringify(completePlanArtifact()), "utf8");

  const accepted = await gate({ planRef: "complete-plan.json" });
  const escaped = await gate({ planRef: "../outside-plan.json" });

  assert.equal(accepted.accepted, true);
  assert.deepEqual(accepted.findings, []);
  assert.equal(escaped.accepted, false);
  assert.ok(escaped.findings.some((finding) => finding.code === "invalid_plan_ref"));
});

test("plan_review_gate accepts Markdown planRef artifacts and rejects root escape", async (t) => {
  const root = await temporaryRoot(t, "tiny-chu-plan-gate-markdown-ref-");
  const plugin = createTinyChuPlugin({ root });
  const gate = planReviewGate(plugin);
  await writeFile(path.join(root, "complete-plan.md"), completeMarkdownPlan(), "utf8");

  const accepted = await gate({ planRef: "complete-plan.md" });
  const escaped = await gate({ planRef: "../outside-plan.md" });

  assert.equal(accepted.accepted, true);
  assert.deepEqual(accepted.findings, []);
  assert.equal(escaped.accepted, false);
  assert.ok(escaped.findings.some((finding) => finding.code === "invalid_plan_ref"));
});

test("public worker dispatch blocks only when supplied plan review context is rejected", async (t) => {
  const root = await temporaryRoot(t, "tiny-chu-plan-gate-dispatch-");
  const plugin = createTinyChuPlugin({ root });

  await assert.rejects(
    () => plugin.tools.public_dispatch({
      prompt: "dispatch after plan gate",
      planReviewGate: { objective: "x", todos: [] },
    }),
    /plan_review_gate rejected/,
  );

  const dispatched = await plugin.tools.public_dispatch({
    prompt: "dispatch after accepted plan gate",
    planReviewGate: completePlanArtifact(),
  });
  assert.equal(dispatched.status, "queued");
});

test("public_dispatch rejects invalid planRef before queue mutation and accepts a valid planRef", async (t) => {
  const root = await temporaryRoot(t, "tiny-chu-plan-gate-public-ref-");
  const plugin = createTinyChuPlugin({ root });
  await writeFile(path.join(root, "invalid-plan.json"), JSON.stringify({ objective: "x", todos: [] }), "utf8");
  await writeFile(path.join(root, "valid-plan.json"), JSON.stringify(completePlanArtifact()), "utf8");

  await assert.rejects(
    () => plugin.tools.public_dispatch({ prompt: "must not queue", planRef: "invalid-plan.json" }),
    /plan_review_gate rejected/,
  );
  assert.equal(await publicJobCount(root), 0);

  const dispatched = await plugin.tools.public_dispatch({ prompt: "queue after valid plan", planRef: "valid-plan.json" });
  assert.equal(dispatched.status, "queued");
  assert.equal(dispatched.context.planRef, "valid-plan.json");
  assert.equal(await publicJobCount(root), 1);
});

test("public_dispatch rejects invalid Markdown planRef before queue mutation and accepts a valid Markdown planRef", async (t) => {
  const root = await temporaryRoot(t, "tiny-chu-plan-gate-public-markdown-ref-");
  const plugin = createTinyChuPlugin({ root });
  await writeFile(path.join(root, "invalid-plan.md"), "# Invalid\n\n## Goal\nx\n", "utf8");
  await writeFile(path.join(root, "valid-plan.md"), completeMarkdownPlan(), "utf8");

  await assert.rejects(
    () => plugin.tools.public_dispatch({ prompt: "must not queue", planRef: "invalid-plan.md" }),
    /plan_review_gate rejected/,
  );
  assert.equal(await publicJobCount(root), 0);

  const dispatched = await plugin.tools.public_dispatch({ prompt: "queue after valid markdown plan", planRef: "valid-plan.md" });
  assert.equal(dispatched.status, "queued");
  assert.equal(dispatched.context.planRef, "valid-plan.md");
  assert.equal(await publicJobCount(root), 1);
});

test("button_workflow_dispatch rejects invalid plan before mutation and accepts a complete plan", async (t) => {
  const root = await temporaryRoot(t, "tiny-chu-plan-gate-button-");
  const plugin = createTinyChuPlugin({ root });

  await assert.rejects(
    () => plugin.tools.button_workflow_dispatch({ plan: { workItems: buttonPlanArtifact().workItems } }),
    /plan_review_gate rejected/,
  );
  assert.equal(await publicJobCount(root), 0);

  const result = await plugin.tools.button_workflow_dispatch({ plan: buttonPlanArtifact() });
  assert.equal(result.dispatched.length, 1);
  assert.equal(result.remaining.length, 0);
  assert.equal(await publicJobCount(root), 1);
});
