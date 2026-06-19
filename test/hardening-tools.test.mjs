import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TinyChuOpenCodePlugin } from "../dist/opencode/plugin.js";
import { createTinyChuPlugin } from "../dist/index.js";

function acceptedButtonPlan(workItems) {
  return {
    objective: "Dispatch button workers with evidence",
    scopePaths: ["src/App.tsx"],
    workItems,
    evidenceRequirements: ["public job JSON", "button evidence refs"],
    qaCommands: ["node --test test/hardening-tools.test.mjs"],
    stopConditions: ["all dispatched jobs persisted"],
    sourceOfTruthRefs: ["AGENTS.md"],
  };
}

test("hardening tools guard commands sessions claims and trace diagrams", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-hardening-tools-"));
  const plugin = createTinyChuPlugin({ root });

  const required = [
    "session_preflight",
    "powershell_command_guard",
    "trace_diagram_render",
    "claim_evidence_check",
    "tiny_chu_install_check",
  ];
  for (const name of required) assert.equal(typeof plugin.tools[name], "function", `${name} tool must be registered`);

  const task = await plugin.tools.task_create({ title: "Trace checkout", priority: "high" });
  await plugin.tools.task_checkpoint({
    id: task.id,
    summary: "mapped trace",
    artifactType: "flowchart",
    passIndex: 3,
    nextSteps: ["render diagram"],
    evidenceRefs: ["fact:ui"],
    openQuestions: ["backend role guard"],
    verificationCommands: ["artifact_check"],
  });
  const preflight = await plugin.tools.session_preflight({ id: task.id, maxFiles: 2, maxSnippets: 4, maxChunks: 1 });
  assert.equal(preflight.latestCheckpoint.sequence, 1);
  assert.deepEqual(preflight.nextSteps, ["render diagram"]);
  assert.ok(preflight.requiredVerificationTools.includes("artifact_check"));
  assert.equal(preflight.budgetLedger.maxFiles, 2);

  const guard = await plugin.tools.powershell_command_guard({ command: "grep -R order ." });
  assert.equal(guard.valid, false);
  assert.ok(guard.diagnostics.some((item) => item.code === "unix_grep"));
  assert.ok(guard.safeAlternatives.some((command) => command.includes("rg --json")));

  const matrix = {
    rows: [
      {
        feature: "Order",
        uiEvent: "Submit Order",
        api: "POST /api/orders",
        backendEntry: "OrderVerticle.createOrder",
        mapperSql: "insertOrder",
        rfcFunction: "Z_CREATE_ORDER",
        status: "complete",
        evidence: ["fact:ui", "fact:api"],
      },
      { feature: "Order", uiEvent: "Cancel", api: "Unknown", status: "partial", gap: "Unknown API", evidence: ["fact:cancel"] },
    ],
  };
  const diagram = await plugin.tools.trace_diagram_render({ artifactType: "flowchart", matrix });
  assert.equal(diagram.valid, true);
  assert.match(diagram.markdown, /flowchart TD/);
  assert.match(diagram.markdown, /Unknown API/);
  assert.ok(diagram.verificationCommands.some((command) => command.includes("mmdc")));
  const checked = await plugin.tools.mermaid_check({ markdown: diagram.markdown });
  assert.equal(checked.valid, true);

  const repoIndex = {
    facts: [
      { id: "fact:ui", kind: "ui_event", file: "src/Order.jsx", line: 1, symbol: "Submit Order", text: "Submit Order", confidence: "verified" },
      { id: "fact:rfc", kind: "rfc_call", file: "src/OrderService.java", line: 7, symbol: "Z_CREATE_ORDER", text: "JCoUtil.call", confidence: "verified" },
    ],
  };
  const claim = await plugin.tools.claim_evidence_check({
    markdown: "## Evidence\n- src/OrderService.java:7 calls Z_CREATE_ORDER and Z_FAKE.",
    evidenceRefs: ["fact:rfc"],
    repoIndex,
  });
  assert.equal(claim.valid, false);
  assert.ok(claim.diagnostics.some((item) => item.code === "unsupported_symbol" && item.symbol === "Z_FAKE"));

  const install = await plugin.tools.tiny_chu_install_check({});
  assert.equal(install.packageName, "tiny-chu");
  assert.equal(install.installDocs, "INSTALL.md");
  assert.equal(install.opencodeShim, "templates/opencode/plugins/tiny-chu.ts");
  assert.equal(install.offlineBundleName, "tiny-chu-offline-vX.Y.Z.tar.gz");
  assert.deepEqual(install.installModes, ["offline-bundle", "internal-registry", "developer-file"]);
  assert.ok(install.requiredTools.includes("task_create"));
  const hooks = await TinyChuOpenCodePlugin({
    project: { root },
    directory: root,
    worktree: root,
    client: { app: { log: async () => undefined } },
    $: async () => undefined,
  });
  assert.deepEqual(install.requiredTools, Object.keys(plugin.tools).sort());
  assert.deepEqual(install.requiredTools, Object.keys(hooks.tool).sort());
});

test("button worker result guard rejects markdown and missing evidence", async () => {
  const plugin = createTinyChuPlugin();
  const envelope = await plugin.tools.markdown_envelope_check({
    value: {
      buttonId: "b1",
      traceRows: [],
      markdown: "```mermaid\nflowchart TD\nA-->B\n```",
    },
  });
  assert.equal(envelope.valid, false);
  assert.ok(envelope.diagnostics.some((diagnostic) => diagnostic.code === "markdown_field"));

  const result = await plugin.tools.button_worker_result_check({
    expectedButtonId: "b1",
    result: {
      buttonId: "b1",
      status: "Verified",
      traceRows: [],
      evidenceRefs: ["missing.ts:1"],
      unknowns: [],
      verificationCommands: [],
    },
    evidenceIndex: { facts: [] },
  });
  assert.equal(result.valid, false);
  assert.ok(result.blockers.some((blocker) => blocker.includes("missing.ts:1")));
});

test("button workflow dispatch persists distinct parallel public jobs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-button-dispatch-"));
  const plugin = createTinyChuPlugin({ root });
  const plan = acceptedButtonPlan([
    { buttonId: "save", file: "src/App.tsx", line: 10, label: "Save", handler: "save", evidenceRefs: ["src/App.tsx:10"] },
    { buttonId: "delete", file: "src/App.tsx", line: 20, label: "Delete", handler: "remove", evidenceRefs: ["src/App.tsx:20"] },
  ]);

  const result = await plugin.tools.button_workflow_dispatch({ plan, maxParallel: 2, taskId: "T-buttons" });

  assert.equal(result.dispatched.length, 2);
  assert.notEqual(result.dispatched[0].id, result.dispatched[1].id);
  const files = await readdir(path.join(root, ".tiny", "public-jobs"));
  assert.equal(files.filter((file) => file.endsWith(".json")).length, 2);
});

test("button workflow drift and done claim fail closed on missing evidence", async () => {
  const plugin = createTinyChuPlugin();
  const drift = await plugin.tools.aggregation_drift_check({
    planned: [{ buttonId: "save", label: "Save", handler: "save", file: "src/App.tsx", line: 10 }],
    observed: [{ buttonId: "save", label: "Delete", handler: "remove", file: "src/App.tsx", line: 10 }],
  });
  assert.equal(drift.status, "blocker");
  assert.ok(drift.blockers.some((blocker) => blocker.includes("label mismatch")));
  assert.ok(drift.blockers.some((blocker) => blocker.includes("handler mismatch")));
  const missingObserved = await plugin.tools.aggregation_drift_check({
    planned: [{ buttonId: "save", label: "Save", handler: "save" }],
    observed: [{ buttonId: "save", label: "Save" }],
  });
  assert.equal(missingObserved.status, "blocker");
  assert.ok(missingObserved.blockers.some((blocker) => blocker.includes("handler missing")));

  const emptyDone = await plugin.tools.button_workflow_done_claim({
    npmTestEvidence: "npm test passed",
    checkpointEvidence: "checkpoint recorded",
  });
  assert.equal(emptyDone.valid, false);
  assert.ok(emptyDone.blockers.includes("missing planned buttons"));
  assert.ok(emptyDone.blockers.includes("missing jobs"));
  assert.ok(emptyDone.blockers.includes("missing validations"));
  assert.ok(emptyDone.blockers.includes("missing artifacts"));
  const blankEvidence = await plugin.tools.button_workflow_done_claim({
    plannedButtonIds: ["save"],
    jobs: [{ buttonId: "save", status: "done" }],
    validation: [{ buttonId: "save", valid: true }],
    artifacts: [{ type: "claim", valid: true }, { type: "mermaid", valid: true }],
    drift: { status: "pass", blockers: [] },
    npmTestEvidence: "",
    checkpointEvidence: " ",
  });
  assert.equal(blankEvidence.valid, false);
  assert.ok(blankEvidence.blockers.includes("missing npm test evidence"));
  assert.ok(blankEvidence.blockers.includes("missing checkpoint evidence"));

  const done = await plugin.tools.button_workflow_done_claim({
    plannedButtonIds: ["save"],
    jobs: [{ buttonId: "save", status: "done" }],
    validation: [{ buttonId: "save", valid: true }],
    artifacts: [{ type: "claim", valid: true }, { type: "mermaid", valid: true }],
    drift: { status: "pass", blockers: [] },
    npmTestEvidence: "npm test passed",
    checkpointEvidence: "checkpoint recorded",
  });
  assert.equal(done.valid, true);
});
