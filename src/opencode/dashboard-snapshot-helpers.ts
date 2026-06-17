import type { PublicJob, PublicJobStatus } from "../dispatcher/public-job.js";
import { createProviderEndpointPreflight, type ProviderEndpointPreflightStatus, type ProviderNetworkMode } from "./provider-endpoint-preflight.js";
import { createWorkflowProgressHeartbeat } from "./workflow-reliability.js";
import type { TaskFocusPacket } from "./task-focus-packet.js";
import type {
  DashboardSnapshotEvidence,
  DashboardSnapshotInterrupt,
  DashboardSnapshotProvider,
  DashboardSnapshotPublicJobs,
  DashboardSnapshotResult,
  DashboardSnapshotTask,
  DashboardSnapshotWorkflow,
} from "./dashboard-snapshot-types.js";
import type { StatusCount } from "./orchestration-health.js";

const MAX_LABEL_CHARS = 120;
const MAX_WARNING_CHARS = 240;
const MAX_DISPLAY_ITEMS = 8;
const JOB_STATUSES: readonly PublicJobStatus[] = ["queued", "running", "checkpointed", "retry_wait", "done", "failed", "cancelled"];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function dashboardTextInput(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function dashboardPositiveInteger(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = input[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

export function validIsoTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

export function warning(value: string): string {
  return clip(value, MAX_WARNING_CHARS);
}

export function errorMessage(error: unknown, fallback: string): string {
  return warning(error instanceof Error ? error.message : fallback);
}

export function taskFocusInput(input: Record<string, unknown>, maxEvidenceRefs: number): Record<string, unknown> {
  const taskId = dashboardTextInput(input, "taskId");
  return {
    ...(taskId ? { id: taskId } : {}),
    maxEvidenceRefs,
    maxOpenItems: dashboardPositiveInteger(input, "maxTasks", 3),
  };
}

export function dashboardTask(focus: TaskFocusPacket): DashboardSnapshotTask {
  if (!focus.found || !focus.task) {
    return { found: false, nextSteps: [], openQuestions: [], evidenceRefs: [] };
  }
  return {
    found: true,
    id: focus.task.id,
    title: clip(focus.task.title, MAX_LABEL_CHARS),
    status: focus.task.status,
    priority: focus.task.priority,
    ...(focus.latestCheckpoint ? { latestCheckpointSummary: clip(focus.latestCheckpoint.summary, MAX_LABEL_CHARS) } : {}),
    nextSteps: clipList(focus.nextSteps),
    openQuestions: clipList(focus.openQuestions),
    evidenceRefs: clipList(focus.evidenceRefs),
  };
}

export function publicJobsSnapshot(jobs: readonly PublicJob[]): DashboardSnapshotPublicJobs {
  return {
    total: jobs.length,
    retryable: retryableJobCount(jobs),
    byStatus: countStatuses(jobs),
    ...(nextRetryAt(jobs) ? { nextRetryAt: nextRetryAt(jobs) } : {}),
  };
}

export async function workflowSnapshot(root: string | undefined, input: Record<string, unknown>, generatedAt: string): Promise<DashboardSnapshotWorkflow> {
  const runId = dashboardTextInput(input, "runId");
  if (!runId) return { found: false, warning: "runId not provided" };
  try {
    const heartbeat = await createWorkflowProgressHeartbeat(root, { runId, now: generatedAt });
    return {
      found: true,
      runId: heartbeat.runId,
      status: heartbeat.status,
      statusLine: clip(heartbeat.statusLine, MAX_LABEL_CHARS),
      shouldContinue: heartbeat.shouldContinue,
    };
  } catch (error) {
    return { found: false, runId, warning: errorMessage(error, "Workflow heartbeat failed.") };
  }
}

export async function providerSnapshot(input: Record<string, unknown>): Promise<DashboardSnapshotProvider> {
  if (input.includeProviderPreflight !== true) {
    return {
      model: "qwen3.6-35b-a3b",
      health: "unknown",
      preflightAttempted: false,
      diagnostics: ["Provider preflight not requested."],
    };
  }
  const preflightInput: Record<string, unknown> = {
    ...(dashboardTextInput(input, "provider") ? { provider: dashboardTextInput(input, "provider") } : {}),
    ...(dashboardTextInput(input, "endpoint") ? { endpoint: dashboardTextInput(input, "endpoint") } : {}),
    ...(networkModeInput(input.networkMode) ? { networkMode: networkModeInput(input.networkMode) } : {}),
  };
  const result = await createProviderEndpointPreflight(preflightInput);
  return {
    model: "qwen3.6-35b-a3b",
    health: providerHealth(result.status),
    preflightAttempted: result.requestAttempted,
    diagnostics: result.diagnostics.map((diagnostic) => warning(diagnostic.message)),
  };
}

export function evidenceSnapshot(task: DashboardSnapshotTask, focus: TaskFocusPacket | undefined): DashboardSnapshotEvidence {
  const warnings = task.openQuestions.map((question) => warning(`Open question: ${question}`));
  const verificationCommands = clipList(focus?.verificationCommands);
  return {
    status: warnings.length > 0 ? "warning" : verificationCommands.length > 0 ? "ok" : "unknown",
    warnings,
    verificationCommands,
  };
}

export function dashboardInterrupts(task: DashboardSnapshotTask, workflow: DashboardSnapshotWorkflow, publicJobs: DashboardSnapshotPublicJobs): readonly DashboardSnapshotInterrupt[] {
  const items: DashboardSnapshotInterrupt[] = [];
  if (task.found && task.status === "blocked" && task.id) {
    items.push(interrupt(`task.blocked.${task.id}`, "danger", "Task blocked", task.title ?? task.id));
  }
  if (task.found && task.status === "done" && task.id) {
    items.push(interrupt(`task.done.${task.id}`, "success", "Task complete", task.title ?? task.id));
  }
  if (task.openQuestions.length > 0) {
    items.push(interrupt(`task.open_questions.${task.id ?? "active"}`, "warning", "Open questions", `${task.openQuestions.length} question(s) need resolution.`));
  }
  if (publicJobs.retryable > 0) {
    items.push(interrupt("public_jobs.retryable", "warning", "Retryable public jobs", `${publicJobs.retryable} public job(s) can be resumed or retried.`));
  }
  if (workflow.found && workflow.status === "stalled" && workflow.runId) {
    items.push(interrupt(`workflow.stalled.${workflow.runId}`, "warning", "Workflow stale", workflow.statusLine ?? workflow.runId));
  }
  if (workflow.found && workflow.status === "blocked" && workflow.runId) {
    items.push(interrupt(`workflow.blocked.${workflow.runId}`, "danger", "Workflow blocked", workflow.statusLine ?? workflow.runId));
  }
  if (workflow.found && workflow.status === "done" && workflow.runId) {
    items.push(interrupt(`workflow.done.${workflow.runId}`, "success", "Workflow complete", workflow.statusLine ?? workflow.runId));
  }
  return items;
}

export function snapshotStatus(warnings: readonly string[], interrupts: readonly DashboardSnapshotInterrupt[], provider: DashboardSnapshotProvider): DashboardSnapshotResult["status"] {
  if (warnings.length > 0 || provider.health === "down") return "degraded";
  if (provider.health === "blocked" || provider.health === "warning") return "attention";
  if (interrupts.some((item) => item.severity === "danger" || item.severity === "warning")) return "attention";
  return "healthy";
}

function clip(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function clipList(values: readonly string[] | undefined, maxItems = MAX_DISPLAY_ITEMS): readonly string[] {
  return (values ?? []).slice(0, maxItems).map((value) => clip(value, MAX_LABEL_CHARS));
}

function networkModeInput(value: unknown): ProviderNetworkMode | undefined {
  if (value === "disabled" || value === "loopback_only" || value === "explicit_hosts") return value;
  return undefined;
}

function countStatuses(jobs: readonly PublicJob[]): readonly StatusCount<PublicJobStatus>[] {
  return JOB_STATUSES
    .map((status) => ({ status, count: jobs.filter((job) => job.status === status).length }))
    .filter((item) => item.count > 0);
}

function retryableJobCount(jobs: readonly PublicJob[]): number {
  return jobs.filter((job) => job.status === "failed" || job.status === "retry_wait" || job.status === "checkpointed").length;
}

function nextRetryAt(jobs: readonly PublicJob[]): string | undefined {
  return jobs
    .map((job) => job.retryAt)
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .sort((left, right) => left.localeCompare(right))[0];
}

function providerHealth(status: ProviderEndpointPreflightStatus): DashboardSnapshotProvider["health"] {
  if (status === "pass") return "ok";
  if (status === "warning") return "warning";
  if (status === "blocked") return "blocked";
  if (status === "fail") return "down";
  return "unknown";
}

function interrupt(key: string, severity: DashboardSnapshotInterrupt["severity"], title: string, message: string): DashboardSnapshotInterrupt {
  return { key, severity, title: clip(title, MAX_LABEL_CHARS), message: warning(message) };
}
