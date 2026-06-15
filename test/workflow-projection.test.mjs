import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as tinyRoot from "../dist/index.js";

function workflowTool(plugin, name) {
  const value = plugin.tools[name];
  assert.equal(typeof value, "function", `${name} tool missing from createTinyChuPlugin().tools`);
  return value;
}

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("workflow projection and stage reports survive plugin reload", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-workflow-projection-test-"));
  const plugin = tinyRoot.createTinyChuPlugin({ root });
  const create = workflowTool(plugin, "workflow_create");
  const checkpoint = workflowTool(plugin, "workflow_checkpoint");

  const created = await create({
    workflowId: "analysis",
    objective: "Projection test workflow",
    targetPath: ".",
  });
  const planPath = path.join(root, created.planRef);
  const initialProjection = await readFile(planPath, "utf8");
  assert.match(initialProjection, /JSON source of truth/);
  assert.match(initialProjection, new RegExp(escaped(created.stateRef)));
  assert.match(initialProjection, /workflow_resume_packet/);
  assert.match(initialProjection, /workflow_next/);
  assert.match(initialProjection, /project_init/);
  assert.match(initialProjection, /final_deliverables/);

  await writeFile(planPath, "stale projection text\n", "utf8");
  const checkpointed = await checkpoint({
    runId: created.runId,
    nodeId: created.currentNodeId,
    summary: "Projection checkpoint written.",
    evidenceRefs: ["README.md:1"],
    nextSteps: ["Continue via workflow_next"],
    status: "checkpointed",
  });
  assert.match(checkpointed.stageReportRef, /^\.tiny\/workflows\/reports\/W-.*\/001-/);

  const reportText = await readFile(path.join(root, checkpointed.stageReportRef), "utf8");
  assert.match(reportText, /Projection checkpoint written/);
  assert.match(reportText, /README\.md:1/);
  assert.match(reportText, /Continue via workflow_next/);
  assert.match(reportText, new RegExp(escaped(created.stateRef)));

  const regeneratedProjection = await readFile(planPath, "utf8");
  assert.equal(regeneratedProjection.includes("stale projection text"), false);
  assert.match(regeneratedProjection, /Projection checkpoint written/);
  assert.match(regeneratedProjection, new RegExp(escaped(checkpointed.stageReportRef)));

  const reloaded = tinyRoot.createTinyChuPlugin({ root });
  const status = await workflowTool(reloaded, "workflow_status")({ runId: created.runId });
  const resume = await workflowTool(reloaded, "workflow_resume_packet")({ runId: created.runId });
  assert.equal(status.planRef, created.planRef);
  assert.equal(status.stateRef, created.stateRef);
  assert.equal(status.latestCheckpoint.stageReportRef, checkpointed.stageReportRef);
  assert.equal(resume.latestCheckpoint.stageReportRef, checkpointed.stageReportRef);
});
