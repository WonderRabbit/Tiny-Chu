import { tinyStateWorkflowLockName, withTinyStateLock } from "./lock-store.js";
import type { TinyStateLock } from "./lock-store.js";

function assertWorkflowRunId(runId: string): void {
  if (!/^W-[A-Za-z0-9_-]+$/.test(runId)) throw new Error(`Invalid workflow run id: ${runId}`);
}

export async function withWorkflowCheckpointLock<T>(root: string | undefined, runId: string, operation: (lock: TinyStateLock) => Promise<T>): Promise<T> {
  assertWorkflowRunId(runId);
  return withTinyStateLock(root, tinyStateWorkflowLockName(runId), operation);
}
