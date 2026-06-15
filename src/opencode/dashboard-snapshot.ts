import { PublicDispatcher, type PublicJob } from "../dispatcher/public-job.js";
import { TaskStore } from "../state/task-store.js";
import { createTaskFocusPacket, type TaskFocusPacket } from "./task-focus-packet.js";
import {
  dashboardInterrupts,
  dashboardTask,
  errorMessage,
  evidenceSnapshot,
  isRecord,
  positiveInteger,
  providerSnapshot,
  publicJobsSnapshot,
  snapshotStatus,
  taskFocusInput,
  textInput,
  validIsoTimestamp,
  warning,
  workflowSnapshot,
} from "./dashboard-snapshot-helpers.js";
import { normalizeTinyChuRuntimeMode } from "./runtime-mode.js";
import type { DashboardSnapshotResult } from "./dashboard-snapshot-types.js";

export type {
  DashboardSnapshotContextBudget,
  DashboardSnapshotEvidence,
  DashboardSnapshotInput,
  DashboardSnapshotInterrupt,
  DashboardSnapshotProvider,
  DashboardSnapshotPublicJobs,
  DashboardSnapshotResult,
  DashboardSnapshotTask,
  DashboardSnapshotWorkflow,
} from "./dashboard-snapshot-types.js";

const DEFAULT_MAX_EVIDENCE_REFS = 8;

export async function createDashboardSnapshot(root: string | undefined, rawInput: Record<string, unknown> = {}): Promise<DashboardSnapshotResult> {
  const input = isRecord(rawInput) ? rawInput : {};
  const runtimeMode = normalizeTinyChuRuntimeMode(input.mode);
  const generatedAt = validIsoTimestamp(textInput(input, "now")) ?? new Date().toISOString();
  const maxEvidenceRefs = positiveInteger(input, "maxEvidenceRefs", DEFAULT_MAX_EVIDENCE_REFS);
  const warnings: string[] = [];
  const tasks = new TaskStore({ root });

  let focus: TaskFocusPacket | undefined;
  try {
    focus = await createTaskFocusPacket(root, tasks, taskFocusInput(input, maxEvidenceRefs));
  } catch (error) {
    warnings.push(`Task focus unavailable: ${errorMessage(error, "Task focus failed.")}`);
  }

  let jobs: readonly PublicJob[] = [];
  try {
    jobs = await new PublicDispatcher({ root }).list();
  } catch (error) {
    warnings.push(`Public jobs unavailable: ${errorMessage(error, "Public job summary failed.")}`);
  }

  const task = focus ? dashboardTask(focus) : { found: false, nextSteps: [], openQuestions: [], evidenceRefs: [] };
  const workflow = await workflowSnapshot(root, input, generatedAt);
  const provider = await providerSnapshot(input);
  const publicJobs = publicJobsSnapshot(jobs);
  const evidence = evidenceSnapshot(task, focus);
  const interrupts = dashboardInterrupts(task, workflow, publicJobs);
  return {
    generatedAt,
    runtimeMode,
    status: snapshotStatus(warnings, interrupts, provider),
    task,
    workflow,
    publicJobs,
    provider,
    contextBudget: { status: "unknown" },
    evidence,
    warnings: warnings.map(warning),
    interrupts,
  };
}
