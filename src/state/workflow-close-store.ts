import path from "node:path";
import { appendJsonLine, writeJsonAtomic } from "./file-store.js";
import { resolveTinyChuPaths } from "./paths.js";
import { withWorkflowCheckpointLock } from "./workflow-lock.js";
import { writeWorkflowPlanProjection } from "./workflow-projection.js";
import type { WorkflowCloseStoreInput } from "./workflow-close-audit-types.js";
import type { WorkflowEvent, WorkflowRun } from "./workflow-types.js";

interface WorkflowCloseRunStateInput extends WorkflowCloseStoreInput {
  readonly root?: string;
  readonly now: () => Date;
  readonly getRun: (runId: string) => Promise<WorkflowRun | undefined>;
  readonly readEvents: (runId: string) => Promise<WorkflowEvent[]>;
}

function assertWorkflowRunId(runId: string): void {
  if (!/^W-[A-Za-z0-9_-]+$/.test(runId)) throw new Error(`Invalid workflow run id: ${runId}`);
}

function runFile(root: string | undefined, runId: string): string {
  assertWorkflowRunId(runId);
  return path.join(resolveTinyChuPaths(root).workflowRunsDir, `${runId}.json`);
}

function eventFile(root: string | undefined, runId: string): string {
  assertWorkflowRunId(runId);
  return path.join(resolveTinyChuPaths(root).workflowRunsDir, `${runId}.events.jsonl`);
}

function assertCloseableRun(run: WorkflowRun): void {
  if (run.status !== "done") throw new Error(`Workflow run must be done before close: ${run.runId}`);
  const missingEvidence = run.checkpoints.find((checkpoint) => checkpoint.status === "done" && checkpoint.evidenceRefs.length === 0);
  if (missingEvidence) throw new Error(`Workflow checkpoint is missing evidence refs: ${missingEvidence.nodeId}`);
}

export async function closeWorkflowRunState(input: WorkflowCloseRunStateInput): Promise<WorkflowRun> {
  return withWorkflowCheckpointLock(input.root, input.runId, async (lock) => {
    const current = await input.getRun(input.runId);
    if (!current) throw new Error(`Workflow run not found: ${input.runId}`);
    assertCloseableRun(current);
    const events = await input.readEvents(input.runId);
    const closedAt = input.now().toISOString();
    const updated: WorkflowRun = {
      ...current,
      status: "closed",
      closeSummary: input.summary,
      closedAt,
      updatedAt: closedAt,
    };
    await lock.assertActive();
    await appendJsonLine(eventFile(input.root, input.runId), {
      sequence: events.length + 1,
      type: "workflow_closed",
      runId: input.runId,
      status: updated.status,
      summary: input.summary,
      createdAt: closedAt,
    } satisfies WorkflowEvent);
    await lock.assertActive();
    await writeJsonAtomic(runFile(input.root, input.runId), updated);
    await lock.assertActive();
    await writeWorkflowPlanProjection(input.root, updated);
    return updated;
  });
}
