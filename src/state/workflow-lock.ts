import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "./file-store.js";
import { resolveTinyChuPaths } from "./paths.js";

const workflowCheckpointLocks = new Map<string, Promise<void>>();
const WORKFLOW_FILE_LOCK_STALE_MS = 30_000;
const WORKFLOW_FILE_LOCK_TIMEOUT_MS = 10_000;
const WORKFLOW_FILE_LOCK_POLL_MS = 25;

function assertWorkflowRunId(runId: string): void {
  if (!/^W-[A-Za-z0-9_-]+$/.test(runId)) throw new Error(`Invalid workflow run id: ${runId}`);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function lockDir(root: string | undefined, runId: string): string {
  assertWorkflowRunId(runId);
  return path.join(resolveTinyChuPaths(root).workflowRunsDir, `.${runId}.lock`);
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function removeStaleLock(dir: string): Promise<boolean> {
  try {
    const snapshot = await stat(dir);
    if (Date.now() - snapshot.mtimeMs <= WORKFLOW_FILE_LOCK_STALE_MS) return false;
    await rm(dir, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return true;
    throw error;
  }
}

async function acquireWorkflowFileLock(root: string | undefined, runId: string): Promise<() => Promise<void>> {
  const dir = lockDir(root, runId);
  await ensureDir(resolveTinyChuPaths(root).workflowRunsDir);
  const startedAt = Date.now();
  for (;;) {
    try {
      await mkdir(dir);
      return async () => {
        await rm(dir, { recursive: true, force: true });
      };
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
      if (await removeStaleLock(dir)) continue;
      if (Date.now() - startedAt > WORKFLOW_FILE_LOCK_TIMEOUT_MS) throw new Error(`Timed out waiting for workflow checkpoint lock: ${runId}`);
      await sleep(WORKFLOW_FILE_LOCK_POLL_MS);
    }
  }
}

export async function withWorkflowCheckpointLock<T>(root: string | undefined, runId: string, operation: () => Promise<T>): Promise<T> {
  const key = `${resolveTinyChuPaths(root).workflowRunsDir}\0${runId}`;
  const previous = workflowCheckpointLocks.get(key) ?? Promise.resolve();
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.then(() => gate, () => gate);
  workflowCheckpointLocks.set(key, chain);
  await previous.then(() => undefined, () => undefined);
  let releaseFileLock: (() => Promise<void>) | undefined;
  try {
    releaseFileLock = await acquireWorkflowFileLock(root, runId);
    return await operation();
  } finally {
    if (releaseFileLock) await releaseFileLock();
    release();
    if (workflowCheckpointLocks.get(key) === chain) workflowCheckpointLocks.delete(key);
  }
}
