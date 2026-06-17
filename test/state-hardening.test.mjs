import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { acquireSafeToolingLock, PublicDispatcher, readJsonLines, TaskStore } from "../dist/index.js";

const distUrl = pathToFileURL(path.join(process.cwd(), "dist", "index.js")).href;
const lockStoreUrl = pathToFileURL(path.join(process.cwd(), "dist", "state", "lock-store.js")).href;
const readyLine = "__tiny_chu_child_ready__";

function malformedJsonMessage(file) {
  return new RegExp(`Malformed JSON in ${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
}

function runNodeScript(script) {
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  let ready = false;
  let released = false;
  let resolveReady;
  let rejectReady;
  let resolveDone;
  let rejectDone;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const done = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const timeout = setTimeout(() => {
    child.kill("SIGKILL");
    const error = new Error("Timed out waiting for child process");
    rejectReady(error);
    rejectDone(error);
  }, 15_000);
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (!ready && stdout.split(/\r?\n/).includes(readyLine)) {
      ready = true;
      resolveReady();
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.once("error", (error) => {
    clearTimeout(timeout);
    rejectReady(error);
    rejectDone(error);
  });
  child.once("close", (code, signal) => {
    clearTimeout(timeout);
    if (!ready) rejectReady(new Error(`Child exited before ready: ${stderr || signal || code}`));
    if (code !== 0) {
      rejectDone(new Error(`Child exited with ${code ?? signal}: ${stderr}`));
      return;
    }
    const lines = stdout.trim().split(/\r?\n/).filter((line) => line && line !== readyLine);
    try {
      resolveDone(JSON.parse(lines.at(-1) ?? ""));
    } catch (error) {
      rejectDone(new Error(`Child did not emit JSON: ${error instanceof Error ? error.message : String(error)}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }
  });
  return {
    ready: readyPromise,
    release: () => {
      if (released) return;
      released = true;
      child.stdin.end("go\n");
    },
    done,
    kill: () => child.kill("SIGKILL"),
  };
}

async function collectReleasedChildren(children) {
  try {
    await Promise.all(children.map((child) => child.ready));
    for (const child of children) child.release();
    return await Promise.all(children.map((child) => child.done));
  } catch (error) {
    for (const child of children) child.kill();
    await Promise.allSettled(children.map((child) => child.done));
    throw error;
  }
}

function readySnippet() {
  return `
    const release = new Promise((resolve) => process.stdin.once("data", resolve));
    console.log(${JSON.stringify(readyLine)});
    await release;
  `;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

test("safe tooling lock treats malformed owners as held until stale", async () => {
  // Given: a malformed safe-tooling owner in a fresh lock directory.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-safe-tooling-stale-"));
  const lockDir = path.join(root, ".tiny", "locks", "safe-tooling.lock");
  await mkdir(lockDir, { recursive: true });
  await writeFile(path.join(lockDir, "owner.json"), "{bad", "utf8");

  // When/Then: non-blocking acquisition refuses the fresh unknown owner.
  assert.equal(await acquireSafeToolingLock(root), undefined);

  // When: the same malformed lock directory is older than the production stale threshold.
  const stale = new Date(Date.now() - 60_000);
  await utimes(lockDir, stale, stale);
  const recovered = await acquireSafeToolingLock(root);
  assert.ok(recovered);
  await recovered.release();

  // Then: the recovered lock is released by owner token and no directory remains.
  await assert.rejects(() => access(lockDir), /ENOENT/);
});

test("safe tooling lock exposes compromised ownership before source writes", async () => {
  // Given: safe tooling acquired the shared source-mutation lock.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-safe-tooling-compromised-"));
  const lock = await acquireSafeToolingLock(root);
  assert.ok(lock);
  const now = new Date();
  const later = new Date(now.getTime() + 60_000);

  try {
    // When: the owner metadata is replaced by another holder token.
    await writeFile(path.join(lock.path, "owner.json"), `${JSON.stringify({
      lockId: "other-owner",
      pid: process.pid,
      hostname: os.hostname(),
      createdAt: now.toISOString(),
      renewedAt: now.toISOString(),
      expiresAt: later.toISOString(),
    })}\n`, "utf8");

    // Then: safe-tooling callers can fail before reporting a successful source write.
    await assert.rejects(
      () => lock.assertActive(),
      (error) => error instanceof Error && error.name === "TinyStateLockCompromisedError" && error.code === "TINY_STATE_LOCK_COMPROMISED",
    );
  } finally {
    await lock.release();
  }
});

test("Tiny state lock timeout errors expose stable codes", async () => {
  // Given: one lock holder keeps a normal state lock active.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-lock-timeout-"));
  const { acquireTinyStateLock, withTinyStateLock } = await import(lockStoreUrl);
  const held = await acquireTinyStateLock(root, "timeout-proof.lock", { staleMs: 1_000, renewMs: 250, pollMs: 5 });
  assert.ok(held);

  try {
    // When/Then: a blocking waiter times out with the documented error code.
    await assert.rejects(
      () => withTinyStateLock(root, "timeout-proof.lock", async () => undefined, { staleMs: 1_000, timeoutMs: 20, pollMs: 5, renewMs: 250 }),
      (error) => error instanceof Error && error.name === "TinyStateLockTimeoutError" && error.code === "TINY_STATE_LOCK_TIMEOUT",
    );
  } finally {
    await held.release();
  }
});

test("Tiny state lock rejects symlinked lock roots", async () => {
  // Given: .tiny itself is a symlink.
  const tinySymlinkRoot = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-lock-tiny-symlink-"));
  const tinyTarget = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-lock-tiny-target-"));
  await symlink(tinyTarget, path.join(tinySymlinkRoot, ".tiny"), "dir");
  const { acquireTinyStateLock } = await import(lockStoreUrl);

  // When/Then: acquisition fails closed before constructing lock paths below a symlink.
  await assert.rejects(() => acquireTinyStateLock(tinySymlinkRoot, "symlink-proof.lock"), /state directory is not a safe directory/);

  // Given: .tiny is real, but .tiny/locks is a symlink.
  const locksSymlinkRoot = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-lock-locks-symlink-"));
  const locksTarget = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-lock-locks-target-"));
  await mkdir(path.join(locksSymlinkRoot, ".tiny"), { recursive: true });
  await symlink(locksTarget, path.join(locksSymlinkRoot, ".tiny", "locks"), "dir");

  // When/Then: acquisition refuses the symlinked lock directory.
  await assert.rejects(() => acquireTinyStateLock(locksSymlinkRoot, "symlink-proof.lock"), /locks directory is not a safe directory/);
});

test("Tiny state lock release cannot remove a stale successor owner", async () => {
  // Given: the first holder stops renewing long enough for another holder to recover the stale lock.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-lock-successor-"));
  const { acquireTinyStateLock } = await import(lockStoreUrl);
  const first = await acquireTinyStateLock(root, "successor-proof.lock", { staleMs: 40, renewMs: 1_000, pollMs: 5 });
  assert.ok(first);
  await sleep(80);
  const second = await acquireTinyStateLock(root, "successor-proof.lock", { staleMs: 40, renewMs: 10, pollMs: 5, timeoutMs: 500 });
  assert.ok(second);

  try {
    // When: the stale first holder releases after a successor has acquired the lock.
    await first.release();

    // Then: the successor lock still exists and remains active.
    await second.assertActive();
    await access(path.join(second.path, "owner.json"));
  } finally {
    await second.release();
  }
});

test("Tiny state lock renewal cannot overwrite a successor recovered during release", async () => {
  // Given: renewal is blocked behind the same lifecycle mutex used by stale recovery.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-lock-renewal-successor-"));
  const { acquireTinyStateLock } = await import(lockStoreUrl);
  const lockName = "renewal-successor-proof.lock";
  const first = await acquireTinyStateLock(root, lockName, { staleMs: 50, renewMs: 20, pollMs: 5 });
  assert.ok(first);
  const reaperDir = `${first.path}.reaper`;
  await mkdir(reaperDir, { recursive: false });
  await sleep(100);

  // When: a successor waits to recover the stale lock while the first holder also releases.
  const successorPromise = acquireTinyStateLock(root, lockName, { staleMs: 50, renewMs: 20, pollMs: 5, timeoutMs: 1_000 });
  const releasePromise = first.release();
  await sleep(20);
  await rm(reaperDir, { recursive: true, force: true });
  const successor = await successorPromise;
  assert.ok(successor);
  await releasePromise;

  try {
    // Then: the successor owner remains current; no in-flight renewal rewrote owner.json.
    await successor.assertActive();
    await access(path.join(successor.path, "owner.json"));
  } finally {
    await successor.release();
  }
});

test("Tiny state lock prevents expired holders from continuing protected writes", async () => {
  // Given: a protected operation loses its lease before it reaches the write point.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-lock-expired-holder-"));
  const { acquireTinyStateLock, withTinyStateLock } = await import(lockStoreUrl);
  let wrote = false;

  // When/Then: once another holder recovers the stale lock, the original holder fails before the guarded write.
  await assert.rejects(
    () => withTinyStateLock(root, "expired-holder-proof.lock", async (lock) => {
      await sleep(80);
      const successor = await acquireTinyStateLock(root, "expired-holder-proof.lock", { staleMs: 40, renewMs: 10, pollMs: 5, timeoutMs: 500 });
      assert.ok(successor);
      await successor.release();
      await lock.assertActive();
      wrote = true;
    }, { staleMs: 40, renewMs: 1_000, pollMs: 5, timeoutMs: 500 }),
    (error) => error instanceof Error && error.name === "TinyStateLockCompromisedError" && error.code === "TINY_STATE_LOCK_COMPROMISED",
  );
  assert.equal(wrote, false);
});

test("TaskStore and PublicDispatcher create distinct files for same-timestamp cross-process records", async () => {
  // Given: child processes share one root and one injected clock tick.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-cross-process-ids-"));
  const fixedNow = "2026-06-13T01:02:03.000Z";
  const workerCount = 6;

  // When: each child creates one task and one public job after the same release signal.
  const children = Array.from({ length: workerCount }, (_, index) => runNodeScript(`
    const { PublicDispatcher, TaskStore } = await import(${JSON.stringify(distUrl)});
    ${readySnippet()}
    const now = () => new Date(${JSON.stringify(fixedNow)});
    const store = new TaskStore({ root: ${JSON.stringify(root)}, now });
    const dispatcher = new PublicDispatcher({ root: ${JSON.stringify(root)}, now });
    const task = await store.create({ title: ${JSON.stringify(`task ${index}`)} });
    const job = await dispatcher.dispatch({ prompt: ${JSON.stringify(`job ${index}`)} });
    console.log(JSON.stringify({ taskId: task.id, jobId: job.id }));
  `));
  const outputs = await collectReleasedChildren(children);
  const taskIds = outputs.map((output) => output.taskId);
  const jobIds = outputs.map((output) => output.jobId);
  const taskFiles = (await readdir(path.join(root, ".tiny", "tasks"))).filter((file) => file.endsWith(".json")).sort();
  const jobFiles = (await readdir(path.join(root, ".tiny", "public-jobs"))).filter((file) => file.endsWith(".json")).sort();

  // Then: every returned id maps to a distinct persisted JSON file.
  assert.equal(taskFiles.length, workerCount, `task ids: ${taskIds.join(", ")}`);
  assert.equal(jobFiles.length, workerCount, `job ids: ${jobIds.join(", ")}`);
  assert.equal(new Set(taskIds).size, workerCount);
  assert.equal(new Set(jobIds).size, workerCount);
  assert.deepEqual(taskFiles, taskIds.map((id) => `${id}.json`).sort());
  assert.deepEqual(jobFiles, jobIds.map((id) => `${id}.json`).sort());
  assert.deepEqual((await new TaskStore({ root }).list()).map((task) => task.title).sort(), Array.from({ length: workerCount }, (_, index) => `task ${index}`));
  assert.deepEqual((await new PublicDispatcher({ root }).list()).map((job) => job.context.prompt).sort(), Array.from({ length: workerCount }, (_, index) => `job ${index}`));
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

test("TaskStore checkpoint sequences stay unique across child processes", async () => {
  // Given: one task receives checkpoints from several released child processes.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-checkpoint-cross-process-"));
  const store = new TaskStore({ root, now: () => new Date("2026-06-13T02:03:04.000Z") });
  const task = await store.create({ title: "cross-process checkpoint race" });
  const fixedNow = "2026-06-13T02:03:05.000Z";
  const workerCount = 12;

  // When: every child checkpoints the same task after the same release signal.
  const children = Array.from({ length: workerCount }, (_, index) => runNodeScript(`
    const { TaskStore } = await import(${JSON.stringify(distUrl)});
    ${readySnippet()}
    const store = new TaskStore({ root: ${JSON.stringify(root)}, now: () => new Date(${JSON.stringify(fixedNow)}) });
    const checkpoint = await store.checkpoint(${JSON.stringify(task.id)}, {
      summary: ${JSON.stringify(`checkpoint ${index}`)},
      evidenceRefs: [${JSON.stringify(`evidence-${index}.txt`)}]
    });
    console.log(JSON.stringify(checkpoint));
  `));
  const checkpoints = await collectReleasedChildren(children);
  const expectedSummaries = Array.from({ length: workerCount }, (_, index) => `checkpoint ${index}`);
  const expectedSequences = Array.from({ length: workerCount }, (_, index) => index + 1);
  const sidecarRecords = await readJsonLines(path.join(root, ".tiny", "tasks", `${task.id}.checkpoints.jsonl`), []);
  const persisted = await store.get(task.id);

  // Then: the sidecar and reconciled task state agree on one unique sequence per checkpoint.
  assert.deepEqual(checkpoints.map((checkpoint) => checkpoint.sequence).sort((left, right) => left - right), expectedSequences);
  assert.equal(sidecarRecords.length, workerCount);
  assert.deepEqual(sidecarRecords.map((checkpoint) => checkpoint.sequence).sort((left, right) => left - right), expectedSequences);
  assert.equal(persisted?.checkpoints.length, workerCount);
  assert.deepEqual(persisted?.checkpoints.map((checkpoint) => checkpoint.sequence).sort((left, right) => left - right), expectedSequences);
  assert.deepEqual(persisted?.checkpoints.map((checkpoint) => checkpoint.summary).sort(), expectedSummaries.sort());
  assert.deepEqual(persisted?.evidenceRefs, Array.from({ length: workerCount }, (_, index) => `evidence-${index}.txt`).sort());
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
        evidenceRefs: ["inline-evidence.txt"],
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
      evidenceRefs: ["sidecar-evidence.txt"],
      openQuestions: [],
      verificationCommands: [],
      createdAt: "2026-06-13T03:04:06.000Z",
    }),
    JSON.stringify({
      sequence: 2,
      summary: "later sidecar checkpoint",
      nextSteps: [],
      evidenceRefs: ["later-sidecar-evidence.txt"],
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
  assert.deepEqual(task?.evidenceRefs, ["inline-evidence.txt", "later-sidecar-evidence.txt", "sidecar-evidence.txt"]);

  // When: a normal update writes the task back after sidecar reconciliation.
  const updated = await store.update("T-reconcile", { status: "in_progress" });

  // Then: sidecar-derived evidence refs are not discarded from the task-level index.
  assert.deepEqual(updated.evidenceRefs, ["inline-evidence.txt", "later-sidecar-evidence.txt", "sidecar-evidence.txt"]);
});
