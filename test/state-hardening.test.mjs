import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PublicDispatcher, TaskStore } from "../dist/index.js";

function malformedJsonMessage(file) {
  return new RegExp(`Malformed JSON in ${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
}

test("TaskStore and PublicDispatcher fail closed when runtime JSON is malformed", async () => {
  // Given: task and public-job state files contain invalid JSON.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-malformed-"));
  const tasksDir = path.join(root, ".tiny", "tasks");
  const jobsDir = path.join(root, ".tiny", "public-jobs");
  const taskFile = path.join(tasksDir, "T-malformed.json");
  const jobFile = path.join(jobsDir, "J-malformed.json");
  await mkdir(tasksDir, { recursive: true });
  await mkdir(jobsDir, { recursive: true });
  await writeFile(taskFile, "{not json", "utf8");
  await writeFile(jobFile, "{not json", "utf8");
  const store = new TaskStore({ root });
  const dispatcher = new PublicDispatcher({ root });

  // When/Then: normal runtime APIs reject with deterministic file-specific errors.
  await assert.rejects(() => store.get("T-malformed"), malformedJsonMessage(taskFile));
  await assert.rejects(() => store.list(), malformedJsonMessage(taskFile));
  await assert.rejects(() => dispatcher.get("J-malformed"), malformedJsonMessage(jobFile));
  await assert.rejects(() => dispatcher.list(), malformedJsonMessage(jobFile));
});

test("TaskStore and PublicDispatcher create distinct files for same-timestamp records", async () => {
  // Given: both stores see the same timestamp for every create operation.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-id-collision-"));
  const now = () => new Date("2026-06-13T01:02:03.000Z");
  const store = new TaskStore({ root, now });
  const dispatcher = new PublicDispatcher({ root, now });

  // When: two tasks and two public jobs are created in the same process.
  const firstTask = await store.create({ title: "first" });
  const secondTask = await store.create({ title: "second" });
  const firstJob = await dispatcher.dispatch({ prompt: "first" });
  const secondJob = await dispatcher.dispatch({ prompt: "second" });

  // Then: the legacy first task id is preserved and all records survive as files.
  assert.equal(firstTask.id, "T-20260613T010203Z");
  assert.notEqual(secondTask.id, firstTask.id);
  assert.notEqual(secondJob.id, firstJob.id);
  await access(path.join(root, ".tiny", "tasks", `${firstTask.id}.json`));
  await access(path.join(root, ".tiny", "tasks", `${secondTask.id}.json`));
  await access(path.join(root, ".tiny", "public-jobs", `${firstJob.id}.json`));
  await access(path.join(root, ".tiny", "public-jobs", `${secondJob.id}.json`));
  assert.deepEqual((await readdir(path.join(root, ".tiny", "tasks"))).filter((file) => file.endsWith(".json")).sort(), [`${firstTask.id}.json`, `${secondTask.id}.json`].sort());
  assert.deepEqual((await readdir(path.join(root, ".tiny", "public-jobs"))).filter((file) => file.endsWith(".json")).sort(), [`${firstJob.id}.json`, `${secondJob.id}.json`].sort());
});

test("TaskStore checkpoint sequences stay unique during same-process concurrency", async () => {
  // Given: one task receives concurrent checkpoint calls in the same process.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-checkpoint-race-"));
  const store = new TaskStore({ root, now: () => new Date("2026-06-13T02:03:04.000Z") });
  const task = await store.create({ title: "checkpoint race" });

  // When: checkpoints are written concurrently.
  const checkpoints = await Promise.all([
    store.checkpoint(task.id, { summary: "checkpoint a" }),
    store.checkpoint(task.id, { summary: "checkpoint b" }),
    store.checkpoint(task.id, { summary: "checkpoint c" }),
    store.checkpoint(task.id, { summary: "checkpoint d" }),
  ]);

  // Then: returned sequences are unique and all records reconcile through get().
  assert.deepEqual([...new Set(checkpoints.map((checkpoint) => checkpoint.sequence))].sort((a, b) => a - b), [1, 2, 3, 4]);
  assert.deepEqual((await store.get(task.id))?.checkpoints.map((checkpoint) => checkpoint.summary).sort(), ["checkpoint a", "checkpoint b", "checkpoint c", "checkpoint d"]);
});

test("TaskStore reconciliation preserves stale inline checkpoints and sidecar records", async () => {
  // Given: a task JSON file still has stale inline checkpoints while sidecar writes also exist.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-sidecar-reconcile-"));
  const tasksDir = path.join(root, ".tiny", "tasks");
  const taskFile = path.join(tasksDir, "T-reconcile.json");
  const sidecarFile = path.join(tasksDir, "T-reconcile.checkpoints.jsonl");
  await mkdir(tasksDir, { recursive: true });
  await writeFile(taskFile, JSON.stringify({
    id: "T-reconcile",
    title: "reconcile",
    status: "todo",
    priority: "normal",
    notes: [],
    createdAt: "2026-06-13T03:04:05.000Z",
    updatedAt: "2026-06-13T03:04:05.000Z",
    evidenceRefs: [],
    publicJobIds: [],
    checkpoints: [
      {
        sequence: 1,
        summary: "stale inline checkpoint",
        nextSteps: [],
        evidenceRefs: [],
        openQuestions: [],
        verificationCommands: [],
        createdAt: "2026-06-13T03:04:05.000Z",
      },
    ],
  }), "utf8");
  await writeFile(sidecarFile, [
    JSON.stringify({
      sequence: 1,
      summary: "sidecar checkpoint from crash window",
      nextSteps: [],
      evidenceRefs: [],
      openQuestions: [],
      verificationCommands: [],
      createdAt: "2026-06-13T03:04:06.000Z",
    }),
    JSON.stringify({
      sequence: 2,
      summary: "later sidecar checkpoint",
      nextSteps: [],
      evidenceRefs: [],
      openQuestions: [],
      verificationCommands: [],
      createdAt: "2026-06-13T03:04:07.000Z",
    }),
    "",
  ].join("\n"), "utf8");
  const store = new TaskStore({ root });

  // When: the task is read through the runtime API.
  const task = await store.get("T-reconcile");

  // Then: reconciliation keeps every distinct inline and sidecar checkpoint.
  assert.deepEqual(task?.checkpoints.map((checkpoint) => checkpoint.summary), [
    "stale inline checkpoint",
    "sidecar checkpoint from crash window",
    "later sidecar checkpoint",
  ]);
});
