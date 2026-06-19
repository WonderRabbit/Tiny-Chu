import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTinyChuPlugin } from "../dist/index.js";

function workflowTool(plugin, name) {
  const value = plugin.tools[name];
  assert.equal(typeof value, "function", `${name} tool missing from createTinyChuPlugin().tools`);
  return value;
}

async function temporaryRoot(t, prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function stateFile(root, runId) {
  return path.join(root, ".tiny", "workflows", "runs", `${runId}.json`);
}

function eventFile(root, runId) {
  return path.join(root, ".tiny", "workflows", "runs", `${runId}.events.jsonl`);
}

async function fileHash(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function createTwoNodeWorkflow(plugin) {
  const create = workflowTool(plugin, "workflow_create");
  const checkpoint = workflowTool(plugin, "workflow_checkpoint");
  const created = await create({
    workflowId: "close-audit-test",
    objective: "Close and audit workflow",
    nodes: [
      { nodeId: "collect", title: "Collect evidence" },
      { nodeId: "verify", title: "Verify evidence", dependencies: ["collect"] },
    ],
  });
  await checkpoint({
    runId: created.runId,
    nodeId: "collect",
    summary: "Collected evidence.",
    evidenceRefs: ["README.md:1"],
    status: "done",
  });
  return { created, checkpoint };
}

test("workflow_close closes a complete workflow and appends a close event", async (t) => {
  const root = await temporaryRoot(t, "tiny-chu-workflow-close-happy-");
  const plugin = createTinyChuPlugin({ root });
  const { created, checkpoint } = await createTwoNodeWorkflow(plugin);
  await checkpoint({
    runId: created.runId,
    nodeId: "verify",
    summary: "Verified evidence.",
    evidenceRefs: ["test/workflow-close-audit.test.mjs:1"],
    status: "done",
  });

  const close = workflowTool(plugin, "workflow_close");
  const closed = await close({ runId: created.runId, evidenceGate: { status: "pass" }, summary: "Ready for final response." });
  const persisted = JSON.parse(await readFile(stateFile(root, created.runId), "utf8"));
  const events = (await readFile(eventFile(root, created.runId), "utf8")).trim().split("\n").map((line) => JSON.parse(line));

  assert.equal(closed.status, "closed");
  assert.equal(persisted.status, "closed");
  assert.equal(persisted.closedAt, closed.closedAt);
  assert.ok(events.some((event) => event.type === "workflow_closed" && event.summary === "Ready for final response."));
  assert.deepEqual(closed.sotRefs, [persisted.stateRef, persisted.planRef]);
});

test("workflow heartbeat and SOT audit treat a closed workflow as terminal", async (t) => {
  const root = await temporaryRoot(t, "tiny-chu-workflow-close-terminal-");
  const plugin = createTinyChuPlugin({ root });
  const { created, checkpoint } = await createTwoNodeWorkflow(plugin);
  await checkpoint({
    runId: created.runId,
    nodeId: "verify",
    summary: "Verified evidence.",
    evidenceRefs: ["test/workflow-close-audit.test.mjs:1"],
    status: "done",
  });
  const close = workflowTool(plugin, "workflow_close");
  const closed = await close({ runId: created.runId, evidenceGate: { status: "pass" }, summary: "Ready for final response." });

  const heartbeat = await workflowTool(plugin, "workflow_progress_heartbeat")({
    runId: created.runId,
    now: "2026-01-01T00:30:00.000Z",
    staleAfterSeconds: 60,
  });
  const audit = await workflowTool(plugin, "workflow_sot_audit")({
    runId: created.runId,
    evidenceGate: { status: "pass" },
    finalResponse: `Done for ${created.runId}; source of truth: ${closed.sotRefs[0]}.`,
  });

  assert.equal(heartbeat.status, "done");
  assert.equal(heartbeat.shouldContinue, false);
  assert.equal(audit.status, "pass");
  assert.deepEqual(audit.diagnostics, []);
});

test("workflow_close rejects missing evidence without mutating the run file", async (t) => {
  const root = await temporaryRoot(t, "tiny-chu-workflow-close-reject-");
  const plugin = createTinyChuPlugin({ root });
  const { created, checkpoint } = await createTwoNodeWorkflow(plugin);
  await checkpoint({
    runId: created.runId,
    nodeId: "verify",
    summary: "Done but missing evidence.",
    status: "done",
  });
  const before = await fileHash(stateFile(root, created.runId));
  const eventsBefore = await readFile(eventFile(root, created.runId), "utf8");

  const close = workflowTool(plugin, "workflow_close");
  const rejected = await close({ runId: created.runId, evidenceGate: { status: "pass" }, summary: "Should not close." });

  assert.equal(rejected.status, "rejected");
  assert.ok(rejected.findings.some((finding) => finding.code === "missing_evidence_ref"));
  assert.equal(await fileHash(stateFile(root, created.runId)), before);
  assert.equal(await readFile(eventFile(root, created.runId), "utf8"), eventsBefore);
});

test("workflow_audit reports drift and evidence gaps without writing workflow state", async (t) => {
  const root = await temporaryRoot(t, "tiny-chu-workflow-audit-");
  const plugin = createTinyChuPlugin({ root });
  const { created, checkpoint } = await createTwoNodeWorkflow(plugin);
  await checkpoint({
    runId: created.runId,
    nodeId: "verify",
    summary: "Done without evidence.",
    status: "done",
  });
  const runPath = stateFile(root, created.runId);
  const run = JSON.parse(await readFile(runPath, "utf8"));
  await writeFile(runPath, `${JSON.stringify({
    ...run,
    updatedAt: "2026-01-01T00:00:00.000Z",
    checkpoints: run.checkpoints.map((item) => item.nodeId === "verify" ? { ...item, sequence: 3 } : item),
  }, null, 2)}\n`, "utf8");
  const reportDir = path.join(root, ".tiny", "workflows", "reports", created.runId);
  await mkdir(reportDir, { recursive: true });
  await writeFile(path.join(reportDir, "999-orphan.md"), "orphan report\n", "utf8");
  const planPath = path.join(root, run.planRef);
  const older = new Date("2026-01-01T00:00:00.000Z");
  const newer = new Date("2026-01-01T00:05:00.000Z");
  await utimes(runPath, older, older);
  await utimes(planPath, newer, newer);
  const before = {
    state: await fileHash(runPath),
    events: await fileHash(eventFile(root, created.runId)),
    planMtime: (await stat(planPath)).mtimeMs,
  };

  const audit = workflowTool(plugin, "workflow_audit");
  const result = await audit({
    runId: created.runId,
    now: "2026-01-01T00:30:00.000Z",
    staleAfterSeconds: 60,
    finalResponse: `Done for ${created.runId} without a state reference.`,
  });
  const codes = result.findings.map((finding) => finding.code).sort();

  assert.equal(result.status, "fail");
  assert.deepEqual(codes, [
    "checkpoint_gap",
    "final_response_missing_state_ref",
    "missing_evidence_ref",
    "orphan_report",
    "projection_newer_than_json",
    "stale_run",
  ]);
  assert.ok(result.findings.every((finding) => Array.isArray(finding.remediationToolCalls)));
  assert.equal(await fileHash(runPath), before.state);
  assert.equal(await fileHash(eventFile(root, created.runId)), before.events);
  assert.equal((await stat(planPath)).mtimeMs, before.planMtime);
});
