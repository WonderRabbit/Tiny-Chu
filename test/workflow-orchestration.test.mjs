import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import * as tinyRoot from "../dist/index.js";

const execFileAsync = promisify(execFile);

const WORKFLOW_EXPORTS = [
  "WorkflowStore",
  "createWorkflow",
  "createWorkflowStatus",
  "createWorkflowCheckpoint",
  "createWorkflowResumePacket",
  "createWorkflowNextPacket",
  "createWorkflowPacketFitCheck",
  "createAnalysisWorkflowDefinition",
  "createWorkflowDefinition",
];

const ANALYSIS_PHASE_IDS = [
  "project_init",
  "architecture_map",
  "development_rules",
  "web_route_inventory",
  "page_layout_flow",
  "api_backend_trace",
  "dao_sql_business_logic",
  "final_deliverables",
];

const WORKFLOW_TOOLS = [
  "workflow_create",
  "workflow_status",
  "workflow_checkpoint",
  "workflow_close",
  "workflow_audit",
  "workflow_resume_packet",
  "workflow_packet_fit_check",
  "workflow_next",
];

function workflowExport(name) {
  const value = tinyRoot[name];
  assert.equal(typeof value, "function", `${name} export missing from root module`);
  return value;
}

function workflowTool(plugin, name) {
  const value = plugin.tools[name];
  assert.equal(typeof value, "function", `${name} tool missing from createTinyChuPlugin().tools`);
  return value;
}

function assertNoInvocationFields(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoInvocationFields(item);
    return;
  }
  for (const key of Object.keys(value)) {
    assert.equal(["tool", "tools", "command", "commands", "allowedTools"].includes(key), false, `definition contains invocation field: ${key}`);
    assertNoInvocationFields(value[key]);
  }
}

test("workflow root exports are creation-oriented and omit workflow_define", () => {
  for (const name of WORKFLOW_EXPORTS) workflowExport(name);

  assert.equal("workflow_define" in tinyRoot, false);
  assert.equal("createWorkflowDefine" in tinyRoot, false);
});

test("workflow tools and registry package are exposed through the direct plugin", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-workflow-registry-"));
  const plugin = tinyRoot.createTinyChuPlugin({ root });

  for (const name of WORKFLOW_TOOLS) workflowTool(plugin, name);

  assert.equal("workflow_define" in plugin.tools, false);
  assert.ok(plugin.registry.packageIds.includes("tiny-chu.workflow-orchestration"));
  for (const name of WORKFLOW_TOOLS) {
    assert.equal(plugin.registry.toolSpecs.find((spec) => spec.name === name)?.packageId, "tiny-chu.workflow-orchestration");
  }
});

test("workflow_create rejects target paths outside the configured root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-workflow-path-"));
  const plugin = tinyRoot.createTinyChuPlugin({ root });
  const create = workflowTool(plugin, "workflow_create");
  const createWorkflow = workflowExport("createWorkflow");

  await assert.rejects(
    () => create({ workflowId: "analysis", objective: "Bad target", targetPath: "../outside" }),
    /outside configured root/,
  );
  await assert.rejects(
    () => createWorkflow({ root, workflowId: "analysis", objective: "Bad direct target", targetPath: "../outside" }),
    /outside configured root/,
  );
});

test("workflow direct plugin lifecycle persists JSON source of truth and resume commands", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-workflow-lifecycle-"));
  const plugin = tinyRoot.createTinyChuPlugin({ root });
  const create = workflowTool(plugin, "workflow_create");
  const status = workflowTool(plugin, "workflow_status");
  const checkpoint = workflowTool(plugin, "workflow_checkpoint");
  const resume = workflowTool(plugin, "workflow_resume_packet");
  const next = workflowTool(plugin, "workflow_next");

  const created = await create({
    workflowId: "analysis",
    objective: "Analyze this project",
    targetPath: ".",
    workerAgent: {
      id: "analysis.worker",
      config: { maxContextTokens: 4096, maxOutputTokens: 768, maxDurationSeconds: 1800 },
    },
  });
  assert.match(created.runId, /^W-/);
  assert.equal(created.workflowId, "analysis");
  assert.equal(created.status, "ready");
  assert.equal(created.planRef, `.tiny/plans/${created.runId}.md`);
  assert.deepEqual(created.nextCommand, { tool: "workflow_next", input: { runId: created.runId } });
  assert.match(created.stateRef, /^\.tiny\/workflows\/runs\/W-.*\.json$/);

  const checkpointed = await checkpoint({
    runId: created.runId,
    nodeId: created.currentNodeId,
    summary: "Init phase finished; architecture phase is next.",
    nextSteps: ["Run workflow_next"],
    evidenceRefs: ["README.md:1"],
    status: "checkpointed",
  });
  assert.equal(checkpointed.sequence, 1);
  assert.equal(checkpointed.status, "checkpointed");

  const current = await status({ runId: created.runId });
  assert.equal(current.latestCheckpoint.summary, "Init phase finished; architecture phase is next.");
  assert.deepEqual(current.resumeCommand, { tool: "workflow_resume_packet", input: { runId: created.runId } });
  assert.equal(current.currentStopPoint.nodeId, created.currentNodeId);
  assert.ok(current.openNodeCount > 0);
  assert.ok(current.doneNodeCount >= 0);

  const packet = await resume({ runId: created.runId });
  assert.equal(packet.runId, created.runId);
  assert.equal(packet.objective, "Analyze this project");
  assert.equal(packet.stopCondition, "return evidence and checkpoint before continuing");
  assert.deepEqual(packet.nextAction.command, { tool: "workflow_next", input: { runId: created.runId } });

  const nextPacket = await next({ runId: created.runId });
  assert.ok(["agent_packet", "split_required", "command", "gate", "blocked", "done"].includes(nextPacket.kind));
});

test("WorkflowStore fails closed for malformed workflow state and reports file or line context", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-workflow-malformed-"));
  await mkdir(path.join(root, ".tiny", "workflows", "runs"), { recursive: true });
  await writeFile(path.join(root, ".tiny", "workflows", "runs", "W-bad.json"), "{not json\n", "utf8");
  await writeFile(path.join(root, ".tiny", "workflows", "runs", "W-bad.events.jsonl"), "{\"ok\":true}\nnot-json\n", "utf8");
  const WorkflowStore = workflowExport("WorkflowStore");
  const store = new WorkflowStore({ root });

  await assert.rejects(() => store.getRun("W-bad"), /W-bad\.json|workflow state/i);
  await assert.rejects(() => store.readEvents("W-bad"), /line 2|W-bad\.events\.jsonl/i);
});

test("built-in analysis workflow definition is dependency-complete and side-effect free", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-analysis-definition-"));
  const createDefinition = workflowExport("createAnalysisWorkflowDefinition");
  const createWorkflow = workflowExport("createWorkflow");
  const definition = createDefinition();

  assert.equal(definition.workflowId, "analysis");
  assert.deepEqual(definition.phases.map((phase) => phase.nodeId), ANALYSIS_PHASE_IDS);
  const previous = new Set();
  for (const phase of definition.phases) {
    for (const dependency of phase.dependencies ?? []) assert.equal(previous.has(dependency), true, `${phase.nodeId} depends on missing or later phase ${dependency}`);
    previous.add(phase.nodeId);
  }
  assertNoInvocationFields(definition);

  const created = await createWorkflow({ root, workflowId: "analysis", objective: "Analyze default workflow", targetPath: "." });
  assert.deepEqual(created.nodes.map((node) => node.nodeId), ANALYSIS_PHASE_IDS);
  assert.equal(created.currentNodeId, "project_init");
});

test("built-in workflow definition rejects unsupported ids and forbidden names", () => {
  const createDefinition = workflowExport("createWorkflowDefinition");
  const first = createDefinition("analysis");
  const second = createDefinition("analysis");

  assert.deepEqual(first, second);
  assert.throws(() => createDefinition("unknown"), /Unsupported workflow id: unknown/);
  assert.equal("workflow_define" in tinyRoot, false);
  assert.equal("createWorkflowDefine" in tinyRoot, false);
  assert.equal(Object.keys(tinyRoot).some((name) => name.includes("workflow_define") || name.includes("WorkflowDefine")), false);
});

test("workflow root helpers persist stop points and produce resume packets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-workflow-helper-stop-"));
  const createWorkflow = workflowExport("createWorkflow");
  const checkpoint = workflowExport("createWorkflowCheckpoint");
  const status = workflowExport("createWorkflowStatus");
  const resume = workflowExport("createWorkflowResumePacket");
  const next = workflowExport("createWorkflowNextPacket");

  const created = await createWorkflow({
    root,
    workflowId: "helper-analysis",
    objective: "Analyze helper workflow",
    targetPath: ".",
    workerAgent: { id: "analysis.worker", config: { maxContextTokens: 4096, maxOutputTokens: 768, maxDurationSeconds: 1800 } },
    nodes: [
      { nodeId: "analysis_init", type: "init", title: "Initialize analysis" },
      { nodeId: "architecture_map", type: "analysis", title: "Map architecture", dependencies: ["analysis_init"] },
    ],
  });
  assert.match(created.runId, /^W-/);
  assert.deepEqual(created.nextCommand, { tool: "workflow_next", input: { runId: created.runId } });

  await checkpoint({ root, runId: created.runId, nodeId: created.currentNodeId, summary: "older checkpoint", nextSteps: ["continue old"], status: "checkpointed" });
  await checkpoint({ root, runId: created.runId, nodeId: created.currentNodeId, summary: "newest checkpoint", nextSteps: ["continue newest"], status: "checkpointed" });

  const current = await status({ root, runId: created.runId });
  assert.equal(current.latestCheckpoint.summary, "newest checkpoint");
  assert.deepEqual(current.currentStopPoint.nextSteps, ["continue newest"]);
  assert.deepEqual(current.resumeCommand, { tool: "workflow_resume_packet", input: { runId: created.runId } });
  assert.equal(current.openNodeCount, 2);

  const packet = await resume({ root, runId: created.runId });
  assert.equal(packet.stopCondition, "return evidence and checkpoint before continuing");
  assert.deepEqual(packet.nextAction.command, { tool: "workflow_next", input: { runId: created.runId } });
  assert.equal(packet.workerExecution.parallel, false);

  const nextPacket = await next({ root, runId: created.runId });
  assert.equal(nextPacket.kind, "agent_packet");
  assert.equal(nextPacket.packet.runId, created.runId);
});

test("workflow root packet fit check auto-splits oversized mixed UI and backend packets", () => {
  const fitCheck = workflowExport("createWorkflowPacketFitCheck");
  const result = fitCheck({
    workerAgent: {
      id: "analysis.worker",
      config: { maxContextTokens: 2048, maxOutputTokens: 512, maxDurationSeconds: 1800 },
    },
    packet: {
      objective: "Analyze checkout page UI and backend DAO SQL flow",
      scopePaths: ["src/app/checkout/page.tsx", "src/server/order/dao.ts", "src/server/order/order.sql"],
      evidenceRefs: Array.from({ length: 20 }, (_, index) => `docs/evidence-${index}.md:1`),
      allowedTools: ["rg", "ast-grep"],
      verification: "cite UI handler, API route, DAO, and SQL evidence",
      stopCondition: "checkpoint each layer",
      requiredSteps: [
        "map UI page",
        "trace button",
        "trace API",
        "trace service",
        "trace DAO",
        "trace SQL",
        "write artifact",
      ],
    },
  });

  assert.equal(result.fits, false);
  assert.equal(result.requiredAction, "split");
  assert.equal(result.contextFit.maxContextTokens, 2048);
  assert.equal(result.contextFit.maxContextSource, "workerAgent.config.maxContextTokens");
  assert.equal(result.contextFit.tokenEstimateMode, "static");
  assert.equal(result.workerExecution.parallel, false);
  assert.equal(result.workerExecution.maxConcurrentWorkers, 1);
  assert.ok(result.diagnostics.some((item) => item.code === "mixed_ui_backend_scope"));
  assert.ok(result.diagnostics.some((item) => item.code === "too_many_evidence_refs"));
  assert.ok(result.splitCandidates.some((candidate) => candidate.scopeKind === "ui"));
  assert.ok(result.splitCandidates.some((candidate) => candidate.scopeKind === "backend"));
});

test("workflow stop-point selection uses newest checkpoint before ready work", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-workflow-stop-point-"));
  const plugin = tinyRoot.createTinyChuPlugin({ root });
  const create = workflowTool(plugin, "workflow_create");
  const checkpoint = workflowTool(plugin, "workflow_checkpoint");
  const status = workflowTool(plugin, "workflow_status");
  const created = await create({ workflowId: "analysis", objective: "Stop point proof", targetPath: "." });

  await checkpoint({
    runId: created.runId,
    nodeId: created.currentNodeId,
    summary: "older checkpoint",
    nextSteps: ["continue old"],
    status: "checkpointed",
  });
  await checkpoint({
    runId: created.runId,
    nodeId: created.currentNodeId,
    summary: "newest checkpoint",
    nextSteps: ["continue newest"],
    status: "checkpointed",
  });

  const current = await status({ runId: created.runId });
  assert.equal(current.currentStopPoint.summary, "newest checkpoint");
  assert.deepEqual(current.latestCheckpoint.nextSteps, ["continue newest"]);
});

test("workflow checkpoint projections ignore tampered planRef paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-workflow-projection-confine-"));
  const plugin = tinyRoot.createTinyChuPlugin({ root });
  const create = workflowTool(plugin, "workflow_create");
  const checkpoint = workflowTool(plugin, "workflow_checkpoint");
  const created = await create({ workflowId: "analysis", objective: "Projection path proof", targetPath: "." });
  const statePath = path.join(root, ".tiny", "workflows", "runs", `${created.runId}.json`);
  const raw = JSON.parse(await readFile(statePath, "utf8"));
  await writeFile(statePath, JSON.stringify({ ...raw, planRef: "../escaped-workflow-plan.md" }), "utf8");

  await checkpoint({
    runId: created.runId,
    nodeId: created.currentNodeId,
    summary: "checkpoint after tamper",
    status: "checkpointed",
  });

  await assert.rejects(() => readFile(path.join(root, "..", "escaped-workflow-plan.md"), "utf8"));
  assert.match(await readFile(path.join(root, ".tiny", "plans", `${created.runId}.md`), "utf8"), /checkpoint after tamper/);
});

test("workflow checkpoint rejects tampered workflow state run ids before projection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-workflow-runid-tamper-"));
  const plugin = tinyRoot.createTinyChuPlugin({ root });
  const create = workflowTool(plugin, "workflow_create");
  const checkpoint = workflowTool(plugin, "workflow_checkpoint");
  const created = await create({ workflowId: "analysis", objective: "Projection run id proof", targetPath: "." });
  const statePath = path.join(root, ".tiny", "workflows", "runs", `${created.runId}.json`);
  const planPath = path.join(root, ".tiny", "plans", `${created.runId}.md`);
  const planBefore = await readFile(planPath, "utf8");
  const raw = JSON.parse(await readFile(statePath, "utf8"));
  await writeFile(statePath, JSON.stringify({ ...raw, runId: "../../../../escaped" }), "utf8");

  await assert.rejects(
    () => checkpoint({
      runId: created.runId,
      nodeId: created.currentNodeId,
      summary: "checkpoint after run id tamper",
      status: "checkpointed",
    }),
    /run id mismatch/,
  );
  assert.equal(await readFile(planPath, "utf8"), planBefore);
});

test("workflow checkpoint rejects non-current dependency-blocked nodes without mutating SOT", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-workflow-current-node-"));
  const plugin = tinyRoot.createTinyChuPlugin({ root });
  const create = workflowTool(plugin, "workflow_create");
  const checkpoint = workflowTool(plugin, "workflow_checkpoint");
  const status = workflowTool(plugin, "workflow_status");
  const created = await create({ workflowId: "analysis", objective: "Current node proof", targetPath: "." });
  const statePath = path.join(root, ".tiny", "workflows", "runs", `${created.runId}.json`);
  const eventPath = path.join(root, ".tiny", "workflows", "runs", `${created.runId}.events.jsonl`);
  const planPath = path.join(root, ".tiny", "plans", `${created.runId}.md`);
  const stateBefore = await readFile(statePath, "utf8");
  const eventsBefore = await readFile(eventPath, "utf8");
  const planBefore = await readFile(planPath, "utf8");

  for (const blockedStatus of ["checkpointed", "done"]) {
    await assert.rejects(
      () => checkpoint({
        runId: created.runId,
        nodeId: "final_deliverables",
        summary: `blocked ${blockedStatus} should not be accepted`,
        status: blockedStatus,
      }),
      /current node|blocked by dependencies/,
    );
  }

  assert.equal(await readFile(statePath, "utf8"), stateBefore);
  assert.equal(await readFile(eventPath, "utf8"), eventsBefore);
  assert.equal(await readFile(planPath, "utf8"), planBefore);
  const current = await status({ runId: created.runId });
  assert.equal(current.currentNodeId, "project_init");
  assert.equal(current.nodes.find((node) => node.nodeId === "final_deliverables")?.status, "blocked");
});

test("workflow checkpoint sequences stay unique during same-process concurrency", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-workflow-checkpoint-concurrency-"));
  const createWorkflow = workflowExport("createWorkflow");
  const checkpoint = workflowExport("createWorkflowCheckpoint");
  const status = workflowExport("createWorkflowStatus");
  const created = await createWorkflow({
    root,
    workflowId: "parallel-checkpoint-proof",
    objective: "Checkpoint concurrency proof",
    nodes: [{ nodeId: "only", title: "Only node" }],
  });

  const checkpoints = await Promise.all(Array.from({ length: 5 }, (_, index) => checkpoint({
    root,
    runId: created.runId,
    nodeId: "only",
    summary: `checkpoint ${index}`,
    status: "checkpointed",
  })));
  const sequences = checkpoints.map((item) => item.sequence).sort((left, right) => left - right);
  assert.deepEqual(sequences, [1, 2, 3, 4, 5]);

  const current = await status({ root, runId: created.runId });
  assert.equal(current.checkpoints.length, 5);
});

test("workflow run ids stay unique across process concurrency", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-workflow-cross-process-create-"));
  const distUrl = pathToFileURL(path.join(process.cwd(), "dist", "index.js")).href;
  const fixedNow = "2026-06-13T04:05:06.000Z";
  const workerCount = 6;
  const runCreate = (index) => execFileAsync(process.execPath, [
    "--input-type=module",
    "--eval",
    `
      const { WorkflowStore } = await import(${JSON.stringify(distUrl)});
      const store = new WorkflowStore({ root: ${JSON.stringify(root)}, now: () => new Date(${JSON.stringify(fixedNow)}) });
      const run = await store.createRun({
        workflowId: ${JSON.stringify("cross-process-create-proof")},
        objective: ${JSON.stringify("Cross-process workflow create proof")},
        nodes: [{ nodeId: ${JSON.stringify("only")}, title: ${JSON.stringify("Only node")} }]
      });
      console.log(JSON.stringify({ index: ${index}, runId: run.runId }));
    `,
  ]);

  const outputs = await Promise.all(Array.from({ length: workerCount }, (_, index) => runCreate(index)));
  const runIds = outputs.map((output) => JSON.parse(output.stdout.trim()).runId);
  const runFiles = (await readdir(path.join(root, ".tiny", "workflows", "runs"))).filter((file) => file.endsWith(".json")).sort();
  const planFiles = (await readdir(path.join(root, ".tiny", "plans"))).filter((file) => file.endsWith(".md")).sort();

  assert.equal(new Set(runIds).size, workerCount);
  assert.deepEqual(runFiles, runIds.map((runId) => `${runId}.json`).sort());
  assert.deepEqual(planFiles, runIds.map((runId) => `${runId}.md`).sort());
});

test("workflow checkpoint sequences stay unique across process concurrency", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-workflow-cross-process-"));
  const createWorkflow = workflowExport("createWorkflow");
  const status = workflowExport("createWorkflowStatus");
  const created = await createWorkflow({
    root,
    workflowId: "cross-process-checkpoint-proof",
    objective: "Cross-process checkpoint concurrency proof",
    nodes: [{ nodeId: "only", title: "Only node" }],
  });
  const distUrl = pathToFileURL(path.join(process.cwd(), "dist", "index.js")).href;
  const runCheckpoint = (summary) => execFileAsync(process.execPath, [
    "--input-type=module",
    "--eval",
    `
      const { createWorkflowCheckpoint } = await import(${JSON.stringify(distUrl)});
      const checkpoint = await createWorkflowCheckpoint({
        root: ${JSON.stringify(root)},
        runId: ${JSON.stringify(created.runId)},
        nodeId: "only",
        summary: ${JSON.stringify(summary)},
        status: "checkpointed"
      });
      console.log(JSON.stringify(checkpoint));
    `,
  ]);

  const outputs = await Promise.all([runCheckpoint("child checkpoint 1"), runCheckpoint("child checkpoint 2")]);
  const checkpoints = outputs.map((output) => JSON.parse(output.stdout.trim()));
  const sequences = checkpoints.map((item) => item.sequence).sort((left, right) => left - right);
  assert.deepEqual(sequences, [1, 2]);

  const current = await status({ root, runId: created.runId });
  assert.equal(current.checkpoints.length, 2);
  assert.deepEqual(current.checkpoints.map((item) => item.sequence).sort((left, right) => left - right), [1, 2]);
});

test("workflow packet fit check auto-splits oversized mixed UI and backend packets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-workflow-fit-"));
  const plugin = tinyRoot.createTinyChuPlugin({ root });
  const fitCheck = workflowTool(plugin, "workflow_packet_fit_check");
  const result = await fitCheck({
    workerAgent: {
      id: "analysis.worker",
      config: { maxContextTokens: 2048, maxOutputTokens: 512, maxDurationSeconds: 1800 },
    },
    packet: {
      objective: "Analyze checkout page UI and backend DAO SQL flow",
      scopePaths: ["src/app/checkout/page.tsx", "src/server/order/dao.ts", "src/server/order/order.sql"],
      evidenceRefs: Array.from({ length: 20 }, (_, index) => `docs/evidence-${index}.md:1`),
      allowedTools: ["rg", "ast-grep"],
      verification: "cite UI handler, API route, DAO, and SQL evidence",
      stopCondition: "checkpoint each layer",
      requiredSteps: [
        "map UI page",
        "trace button",
        "trace API",
        "trace service",
        "trace DAO",
        "trace SQL",
        "write artifact",
      ],
    },
  });

  assert.equal(result.fits, false);
  assert.equal(result.requiredAction, "split");
  assert.equal(result.contextFit.maxContextTokens, 2048);
  assert.equal(result.contextFit.maxContextSource, "workerAgent.config.maxContextTokens");
  assert.equal(result.contextFit.tokenEstimateMode, "static");
  assert.equal(result.workerExecution.parallel, false);
  assert.equal(result.workerExecution.maxConcurrentWorkers, 1);
  assert.ok(result.diagnostics.some((item) => item.code === "mixed_ui_backend_scope"));
  assert.ok(result.diagnostics.some((item) => item.code === "too_many_evidence_refs"));
  assert.ok(result.splitCandidates.some((candidate) => candidate.scopeKind === "ui"));
  assert.ok(result.splitCandidates.some((candidate) => candidate.scopeKind === "backend"));
});
