import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as tinyRoot from "../dist/index.js";

function workflowTool(plugin, name) {
  const value = plugin.tools[name];
  assert.equal(typeof value, "function", `${name} tool missing from createTinyChuPlugin().tools`);
  return value;
}

function nodeStatus(status, nodeId) {
  const node = status.nodes.find((candidate) => candidate.nodeId === nodeId);
  assert.ok(node, `${nodeId} node missing`);
  return node.status;
}

async function createAnalysisRun(root) {
  const plugin = tinyRoot.createTinyChuPlugin({ root });
  const create = workflowTool(plugin, "workflow_create");
  const created = await create({
    workflowId: "analysis",
    objective: "Advance analysis workflow",
    targetPath: ".",
  });
  return { plugin, created };
}

test("workflow_next advances to the next dependency-ready phase after a done checkpoint", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-workflow-advance-"));
  const { plugin, created } = await createAnalysisRun(root);
  const checkpoint = workflowTool(plugin, "workflow_checkpoint");
  const status = workflowTool(plugin, "workflow_status");
  const next = workflowTool(plugin, "workflow_next");

  await checkpoint({
    runId: created.runId,
    nodeId: "project_init",
    summary: "Project initialization finished.",
    evidenceRefs: ["README.md:1"],
    status: "done",
    nextSteps: ["Continue with architecture_map"],
  });

  const current = await status({ runId: created.runId });
  assert.equal(current.status, "running");
  assert.equal(current.currentNodeId, "architecture_map");
  assert.equal(current.currentStopPoint.nodeId, "architecture_map");
  assert.equal(nodeStatus(current, "project_init"), "done");
  assert.equal(nodeStatus(current, "architecture_map"), "ready");
  assert.equal(current.doneNodeCount, 1);
  assert.equal(current.openNodeCount, 7);

  const nextPacket = await next({ runId: created.runId });
  assert.equal(nextPacket.kind, "agent_packet");
  assert.equal(nextPacket.packet.nodeId, "architecture_map");
});

test("workflow_checkpoint keeps checkpointed pauses resumable and completes only after final done checkpoint", async () => {
  const pausedRoot = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-workflow-pause-"));
  const paused = await createAnalysisRun(pausedRoot);
  await workflowTool(paused.plugin, "workflow_checkpoint")({
    runId: paused.created.runId,
    nodeId: "project_init",
    summary: "Pause in project initialization.",
    status: "checkpointed",
    nextSteps: ["Resume project_init"],
  });
  const pausedResume = await workflowTool(paused.plugin, "workflow_resume_packet")({ runId: paused.created.runId });
  assert.equal(pausedResume.nodeId, "project_init");

  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-workflow-complete-"));
  const { plugin, created } = await createAnalysisRun(root);
  const checkpoint = workflowTool(plugin, "workflow_checkpoint");
  const status = workflowTool(plugin, "workflow_status");
  const next = workflowTool(plugin, "workflow_next");
  let currentNodeId = created.currentNodeId;

  for (const expectedNodeId of [
    "project_init",
    "architecture_map",
    "development_rules",
    "web_route_inventory",
    "page_layout_flow",
    "api_backend_trace",
    "dao_sql_business_logic",
    "final_deliverables",
  ]) {
    assert.equal(currentNodeId, expectedNodeId);
    await checkpoint({
      runId: created.runId,
      nodeId: expectedNodeId,
      summary: `${expectedNodeId} finished.`,
      status: "done",
      nextSteps: [],
    });
    const current = await status({ runId: created.runId });
    currentNodeId = current.currentNodeId;
  }

  const finished = await status({ runId: created.runId });
  assert.equal(finished.status, "done");
  assert.equal(finished.doneNodeCount, 8);
  assert.equal(finished.openNodeCount, 0);
  assert.equal(finished.nodes.every((node) => node.status === "done"), true);
  assert.equal((await next({ runId: created.runId })).kind, "done");
});
