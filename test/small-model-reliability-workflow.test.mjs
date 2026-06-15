import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTinyChuPlugin } from "../dist/index.js";

test("provider and tool-call probes are offline-first and fail closed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-provider-probe-"));
  const plugin = createTinyChuPlugin({ root });

  const skipped = await plugin.tools.provider_endpoint_preflight({
    endpoint: "http://127.0.0.1:11434",
    provider: "ollama",
  });
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.requestAttempted, false);
  assert.ok(skipped.diagnostics.some((item) => item.code === "network_disabled"));

  const blocked = await plugin.tools.provider_endpoint_preflight({
    endpoint: "https://api.openai.com/v1/models",
    provider: "openai_compatible",
    networkMode: "loopback_only",
  });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.requestAttempted, false);
  assert.ok(blocked.diagnostics.some((item) => item.code === "remote_endpoint_blocked"));

  const conforming = await plugin.tools.tool_call_conformance_probe({
    allowedTools: ["context_bundle"],
    fixture: {
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "context_bundle", arguments: "{\"targetPath\":\".\"}" },
        },
      ],
    },
  });
  assert.equal(conforming.status, "pass");
  assert.equal(conforming.requestAttempted, false);
  assert.deepEqual(conforming.toolCalls.map((item) => item.toolName), ["context_bundle"]);
  assert.ok(conforming.toolCalls.every((item) => item.valid));

  const nonconforming = await plugin.tools.tool_call_conformance_probe({
    allowedTools: ["context_bundle"],
    fixture: { content: "I would use context_bundle on README.md." },
  });
  assert.equal(nonconforming.status, "fail");
  assert.ok(nonconforming.diagnostics.some((item) => item.code === "missing_tool_calls"));
});

test("security gates redact provider endpoints and reject malformed tool call arguments", async () => {
  const plugin = createTinyChuPlugin();

  const credentialed = await plugin.tools.provider_endpoint_preflight({
    endpoint: "http://user:secret-token@127.0.0.1:11434?api_key=secret-query#frag",
    provider: "ollama",
    timeoutMs: 60_000,
  });
  assert.equal(credentialed.status, "skipped");
  assert.equal(credentialed.requestAttempted, false);
  assert.equal(credentialed.timeoutMs, 5000);
  assert.doesNotMatch(credentialed.endpoint, /user|secret-token|api_key|secret-query|frag/);

  const malformedArguments = await plugin.tools.tool_call_conformance_probe({
    allowedTools: ["context_bundle"],
    fixture: {
      tool_calls: [
        {
          id: "call_bad",
          type: "function",
          function: { name: "context_bundle", arguments: { targetPath: "../outside" } },
        },
      ],
    },
  });
  assert.equal(malformedArguments.status, "fail");
  assert.ok(malformedArguments.diagnostics.some((item) => item.code === "invalid_tool_arguments"));
});

test("budget simulation, evidence gate, and replay turn fuzzy model output into measurable gates", async () => {
  const plugin = createTinyChuPlugin();

  const budget = await plugin.tools.context_budget_simulation({
    model: "gemma4-7b",
    maxContextTokens: 8192,
    reservedOutputTokens: 1024,
    packets: [
      { name: "rules", text: "AGENTS.md".repeat(200) },
      { name: "repo map", text: "src/opencode/tiny-plugin.ts\n".repeat(300) },
    ],
  });
  assert.equal(budget.model, "gemma4-7b");
  assert.equal(budget.tokenEstimateMode, "static_char_4");
  assert.ok(budget.usableInputTokens < budget.maxContextTokens);
  assert.ok(["fit", "split_required"].includes(budget.status));
  assert.ok(budget.packets.every((packet) => packet.estimatedTokens > 0));

  const gate = await plugin.tools.evidence_gate({
    required: ["build", "sot"],
    checks: [
      { name: "build", status: "pass", evidenceRef: ".omo/evidence/build.txt" },
      { name: "sot", status: "fail", summary: "final answer did not cite workflow state" },
    ],
  });
  assert.equal(gate.status, "fail");
  assert.deepEqual(gate.missingRequired, []);
  assert.ok(gate.diagnostics.some((item) => item.code === "required_check_failed"));

  const malformedGate = await plugin.tools.evidence_gate({
    required: ["build"],
    checks: [{ name: "build" }],
  });
  assert.equal(malformedGate.status, "fail");
  assert.ok(malformedGate.diagnostics.some((item) => item.code === "required_check_status_missing"));
  assert.ok(malformedGate.diagnostics.some((item) => item.code === "required_check_evidence_missing"));

  const malformedEvidenceRefsGate = await plugin.tools.evidence_gate({
    required: ["build"],
    checks: [{ name: "build", status: "pass", evidenceRefs: [{}] }],
  });
  assert.equal(malformedEvidenceRefsGate.status, "fail");
  assert.ok(malformedEvidenceRefsGate.diagnostics.some((item) => item.code === "required_check_evidence_missing"));

  const replay = await plugin.tools.small_model_replay({
    cases: [
      {
        name: "requires citation",
        expected: "workflow_sot_audit",
        actual: "workflow_sot_audit",
        evidenceRefs: [".tiny/workflows/runs/W-test.json"],
      },
      {
        name: "hallucinated file",
        expected: "cite real file",
        actual: "src/ghost.ts",
        evidenceRefs: [],
      },
    ],
  });
  assert.equal(replay.totalCases, 2);
  assert.equal(replay.failedCases, 1);
  assert.equal(replay.status, "fail");
  assert.ok(replay.cases.some((item) => item.diagnostics.some((diagnostic) => diagnostic.code === "missing_evidence_ref")));

  const emptyReplay = await plugin.tools.small_model_replay({ cases: [] });
  assert.equal(emptyReplay.status, "fail");
  assert.ok(emptyReplay.diagnostics.some((item) => item.code === "missing_replay_cases"));
});

test("analysis workflow start, heartbeat, SOT audit, and public job resume preserve progress", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-analysis-start-"));
  const plugin = createTinyChuPlugin({ root });

  const started = await plugin.tools.analysis_workflow_start({
    objective: "Analyze repository with gemma4 7b and qwen3.6 35b a3b",
    targetPath: ".",
    workerAgent: { id: "local.qwen", config: { maxContextTokens: 8192, maxOutputTokens: 1024 } },
  });
  assert.equal(started.workflow.workflowId, "analysis");
  assert.match(started.workflow.runId, /^W-/);
  assert.match(started.task.id, /^T-/);
  assert.deepEqual(started.nextCommand, { tool: "workflow_next", input: { runId: started.workflow.runId } });
  assert.ok(started.requiredFirstTools.includes("provider_endpoint_preflight"));
  assert.ok(started.requiredFirstTools.includes("context_budget_simulation"));
  assert.ok(started.requiredFirstTools.includes("workflow_progress_heartbeat"));
  assert.ok(started.requiredFirstTools.includes("workflow_sot_audit"));

  const heartbeat = await plugin.tools.workflow_progress_heartbeat({ runId: started.workflow.runId });
  assert.equal(heartbeat.runId, started.workflow.runId);
  assert.equal(heartbeat.shouldContinue, true);
  assert.equal(heartbeat.status, "active");
  assert.ok(heartbeat.sotRefs.includes(started.workflow.stateRef));
  assert.match(heartbeat.statusLine, /open/);

  const earlyAudit = await plugin.tools.workflow_sot_audit({
    runId: started.workflow.runId,
    finalResponse: "Analysis complete.",
    evidenceGate: { status: "pass" },
  });
  assert.equal(earlyAudit.status, "fail");
  assert.ok(earlyAudit.diagnostics.some((item) => item.code === "workflow_not_done"));

  const simple = await plugin.tools.workflow_create({
    workflowId: "single-node",
    objective: "Single node audit",
    nodes: [{ nodeId: "only", title: "Only node" }],
  });
  await plugin.tools.workflow_checkpoint({
    runId: simple.runId,
    nodeId: "only",
    summary: "Done with evidence.",
    status: "done",
    evidenceRefs: ["README.md:1"],
  });
  const passAudit = await plugin.tools.workflow_sot_audit({
    runId: simple.runId,
    finalResponse: `Done. SOT ${simple.stateRef} evidence README.md:1 run ${simple.runId}.`,
    evidenceGate: { status: "pass" },
  });
  assert.equal(passAudit.status, "pass");

  const publicJob = await plugin.tools.public_dispatch({
    prompt: "Summarize repository risk",
    mustReturn: ["evidence-backed summary"],
  });
  await plugin.tools.public_checkpoint({
    id: publicJob.id,
    summary: "Mapped README and package metadata",
    result: "Need more backend evidence",
  });
  const resume = await plugin.tools.public_job_resume_packet({ id: publicJob.id });
  assert.equal(resume.jobId, publicJob.id);
  assert.equal(resume.status, "checkpointed");
  assert.ok(resume.resumePrompt.includes("Summarize repository risk"));
  assert.ok(resume.resumePrompt.includes("Mapped README and package metadata"));
  assert.deepEqual(resume.nextAction, { tool: "public_collect", input: { id: publicJob.id } });
});

test("public job resume packet redacts and bounds prompt material", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-public-resume-redact-"));
  const plugin = createTinyChuPlugin({ root });
  const job = await plugin.tools.public_dispatch({
    prompt: `Summarize repository risk for test@example.com api_key=secret-query ${"A".repeat(5000)}`,
    mustReturn: ["summary", `token=secret-return ${"R".repeat(5000)}`],
  });
  await plugin.tools.public_checkpoint({
    id: job.id,
    summary: "Checkpoint token=secret-token",
    result: "Partial password=secret-password",
  });

  const resume = await plugin.tools.public_job_resume_packet({ id: job.id });
  const returnSection = resume.resumePrompt.split("\nReturn: ")[1] ?? "";
  assert.ok(resume.resumePrompt.length <= 3100);
  assert.ok(returnSection.length <= 760);
  assert.match(resume.resumePrompt, /\[redacted-email\]/);
  assert.match(resume.resumePrompt, /\[redacted-secret\]/);
  assert.match(returnSection, /\[truncated \d+ chars\]/);
  assert.doesNotMatch(resume.resumePrompt, /test@example\.com|secret-query|secret-token|secret-password|secret-return/);
});

test("tool usage plan and rules snapshot encode repository analysis reliability gates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-analysis-plan-"));
  const plugin = createTinyChuPlugin({ root });

  const plan = await plugin.tools.tool_usage_plan({
    objective: "analyze opencode repository with gemma4 foreman",
  });
  assert.deepEqual(plan.steps.map((step) => step.tinyTool), [
    "analysis_workflow_start",
    "provider_endpoint_preflight",
    "tool_call_conformance_probe",
    "context_budget_simulation",
    "workflow_next",
    "workflow_progress_heartbeat",
    "evidence_gate",
    "workflow_sot_audit",
  ]);
  assert.deepEqual(plan.verification.requiredTools, ["evidence_gate", "workflow_sot_audit", "task_checkpoint"]);

  const snapshot = await plugin.tools.rules_snapshot({ includeStackProfiles: true });
  assert.ok(snapshot.rules.some((rule) => rule.includes("provider_endpoint_preflight")));
  assert.ok(snapshot.rules.some((rule) => rule.includes("analysis_workflow_start")));
});
