import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createDashboardSnapshot,
  createWorkflow,
  PublicDispatcher,
  TaskStore,
} from "../dist/index.js";

async function createRoot() {
  return mkdtemp(path.join(os.tmpdir(), "tiny-chu-dashboard-snapshot-"));
}

test("dashboard snapshot selects the active task and bounds task detail", async () => {
  const root = await createRoot();
  const tasks = new TaskStore({ root });
  const task = await tasks.create({
    title: "Review " + "dashboard ".repeat(20),
    priority: "high",
  });
  await tasks.update(task.id, { status: "in_progress" });
  await tasks.checkpoint(task.id, {
    summary: "Checkpoint " + "summary ".repeat(30),
    nextSteps: ["Implement slots", "Run QA"],
    evidenceRefs: ["src/opencode/tui-plugin.ts:1", "test/opencode-tui-plugin.test.mjs:1"],
    openQuestions: ["Should alert once?", "Can fallback smoke cover TUI?"],
    verificationCommands: ["npm test"],
  });

  const snapshot = await createDashboardSnapshot(root, {
    now: "2026-06-15T12:00:00.000Z",
    maxEvidenceRefs: 1,
  });

  assert.equal(snapshot.generatedAt, "2026-06-15T12:00:00.000Z");
  assert.equal(snapshot.runtimeMode, "orchestrator_worker");
  assert.equal(snapshot.task.found, true);
  assert.equal(snapshot.task.id, task.id);
  assert.equal(snapshot.task.status, "in_progress");
  assert.equal(snapshot.task.priority, "high");
  assert.ok(snapshot.task.title.length <= 120);
  assert.ok(snapshot.task.latestCheckpointSummary.length <= 120);
  assert.deepEqual(snapshot.task.nextSteps, ["Implement slots", "Run QA"]);
  assert.deepEqual(snapshot.task.openQuestions, ["Should alert once?", "Can fallback smoke cover TUI?"]);
  assert.deepEqual(snapshot.task.evidenceRefs, ["src/opencode/tui-plugin.ts:1"]);
  assert.deepEqual(snapshot.evidence.verificationCommands, ["npm test"]);
  assert.equal(snapshot.workflow.found, false);
  assert.equal(snapshot.workflow.warning, "runId not provided");
  assert.equal(snapshot.provider.model, "qwen3.6-35b-a3b");
  assert.equal(snapshot.provider.health, "unknown");
  assert.equal(snapshot.provider.preflightAttempted, false);
  assert.equal(snapshot.contextBudget.status, "unknown");
});

test("dashboard snapshot reports selected runtime mode metadata", async () => {
  const root = await createRoot();

  const workerSnapshot = await createDashboardSnapshot(root, { mode: "worker" });
  const aliasSnapshot = await createDashboardSnapshot(root, { mode: 1 });
  const defaultSnapshot = await createDashboardSnapshot(root, {});

  assert.equal(workerSnapshot.runtimeMode, "worker");
  assert.equal(aliasSnapshot.runtimeMode, "worker");
  assert.equal(defaultSnapshot.runtimeMode, "orchestrator_worker");
});

test("dashboard snapshot reports empty state without throwing", async () => {
  const root = await createRoot();

  const snapshot = await createDashboardSnapshot(root, {});

  assert.equal(snapshot.status, "healthy");
  assert.deepEqual(snapshot.task, { found: false, nextSteps: [], openQuestions: [], evidenceRefs: [] });
  assert.equal(snapshot.publicJobs.total, 0);
  assert.equal(snapshot.publicJobs.retryable, 0);
  assert.deepEqual(snapshot.publicJobs.byStatus, []);
  assert.deepEqual(snapshot.interrupts, []);
});

test("dashboard snapshot summarizes public jobs deterministically", async () => {
  const root = await createRoot();
  const dispatcher = new PublicDispatcher({
    root,
    now: () => new Date("2026-06-15T12:00:00.000Z"),
  });
  await dispatcher.dispatch({ prompt: "queued job" });
  const retryable = await dispatcher.dispatch({ prompt: "retry job" });
  await dispatcher.retry(retryable.id, "rate limited");

  const snapshot = await createDashboardSnapshot(root, {});

  assert.equal(snapshot.status, "attention");
  assert.equal(snapshot.publicJobs.total, 2);
  assert.equal(snapshot.publicJobs.retryable, 1);
  assert.deepEqual(snapshot.publicJobs.byStatus, [
    { status: "queued", count: 1 },
    { status: "retry_wait", count: 1 },
  ]);
  assert.equal(snapshot.publicJobs.nextRetryAt, "2026-06-15T12:00:15.000Z");
  assert.ok(snapshot.interrupts.some((item) => item.key === "public_jobs.retryable"));
});

test("dashboard snapshot public job status counts include jobs beyond maxJobs", async () => {
  const root = await createRoot();
  const dispatcher = new PublicDispatcher({
    root,
    now: () => new Date("2026-06-15T12:00:00.000Z"),
  });
  for (let index = 0; index < 8; index += 1) {
    await dispatcher.dispatch({ prompt: `queued job ${index}` });
  }
  const retryable = await dispatcher.dispatch({ prompt: "retry job beyond maxJobs" });
  await dispatcher.retry(retryable.id, "rate limited");

  const snapshot = await createDashboardSnapshot(root, { maxJobs: 8 });

  assert.equal(snapshot.publicJobs.total, 9);
  assert.equal(snapshot.publicJobs.retryable, 1);
  assert.deepEqual(snapshot.publicJobs.byStatus, [
    { status: "queued", count: 8 },
    { status: "retry_wait", count: 1 },
  ]);
});

test("dashboard snapshot reads workflow heartbeat only when a run id is supplied", async () => {
  const root = await createRoot();
  const workflow = await createWorkflow({
    root,
    workflowId: "dashboard",
    objective: "Render dashboard state",
    nodes: [{ nodeId: "render", title: "Render dashboard" }],
  });

  const withoutRun = await createDashboardSnapshot(root, {});
  const withRun = await createDashboardSnapshot(root, {
    runId: workflow.runId,
    now: "2026-06-15T12:00:00.000Z",
  });

  assert.equal(withoutRun.workflow.found, false);
  assert.equal(withoutRun.workflow.warning, "runId not provided");
  assert.equal(withRun.workflow.found, true);
  assert.equal(withRun.workflow.runId, workflow.runId);
  assert.equal(withRun.workflow.status, "active");
  assert.equal(withRun.workflow.shouldContinue, true);
  assert.match(withRun.workflow.statusLine, new RegExp(workflow.runId));
});

test("dashboard snapshot only performs provider preflight when opted in", async () => {
  const root = await createRoot();
  const defaultSnapshot = await createDashboardSnapshot(root, {
    provider: "ollama",
    endpoint: "http://127.0.0.1:11434",
    networkMode: "loopback_only",
  });
  const optInSnapshot = await createDashboardSnapshot(root, {
    includeProviderPreflight: true,
    provider: "ollama",
    endpoint: "http://127.0.0.1:11434",
    networkMode: "disabled",
  });

  assert.equal(defaultSnapshot.provider.preflightAttempted, false);
  assert.deepEqual(defaultSnapshot.provider.diagnostics, ["Provider preflight not requested."]);
  assert.equal(optInSnapshot.provider.health, "unknown");
  assert.equal(optInSnapshot.provider.preflightAttempted, false);
  assert.ok(optInSnapshot.provider.diagnostics.some((item) => item.includes("Network probing is disabled")));
});
