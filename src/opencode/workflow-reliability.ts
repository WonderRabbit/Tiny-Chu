import { PublicDispatcher } from "../dispatcher/public-job.js";
import { resolveTinyChuPaths } from "../state/paths.js";
import { resolvePathInsideRoot } from "../state/path-safety.js";
import { TaskStore, type TinyTask } from "../state/task-store.js";
import { createWorkflow, createWorkflowStatus } from "../state/workflow-helpers.js";
import type { WorkflowCreateResult, WorkflowRunStatus, WorkflowStatusResult, WorkflowToolCommand, WorkflowWorkerAgent } from "../state/workflow-types.js";

export { createWorkflowAudit, createWorkflowClose } from "./workflow-close-audit.js";

export type WorkflowReliabilityStatus = "active" | "waiting" | "stalled" | "blocked" | "done";

export interface AnalysisWorkflowStartResult {
  readonly task: TinyTask;
  readonly workflow: WorkflowCreateResult;
  readonly nextCommand: WorkflowToolCommand;
  readonly requiredFirstTools: readonly string[];
}

export interface WorkflowProgressHeartbeatResult {
  readonly status: WorkflowReliabilityStatus;
  readonly runId: string;
  readonly shouldContinue: boolean;
  readonly statusLine: string;
  readonly sotRefs: readonly string[];
}

export interface WorkflowSotAuditResult {
  readonly status: "pass" | "fail";
  readonly runId: string;
  readonly diagnostics: readonly {
    readonly code: string;
    readonly severity: "error" | "info";
    readonly message: string;
  }[];
  readonly sotRefs: readonly string[];
}

export interface PublicJobResumePacketResult {
  readonly jobId: string;
  readonly status: string;
  readonly resumePrompt: string;
  readonly nextAction: {
    readonly tool: string;
    readonly input: {
      readonly id: string;
    };
  };
}

const REQUIRED_FIRST_TOOLS = [
  "provider_endpoint_preflight",
  "tool_call_conformance_probe",
  "context_budget_simulation",
  "workflow_next",
  "workflow_progress_heartbeat",
  "workflow_sot_audit",
] as const;

const MAX_RESUME_SECTION_CHARS = 700;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(input: Record<string, unknown>, key: string, fallback = ""): string {
  const value = input[key];
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function positiveInteger(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = input[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function workerAgent(value: unknown): WorkflowWorkerAgent | undefined {
  if (!isRecord(value)) return undefined;
  const config = isRecord(value.config)
    ? {
        maxContextTokens: positiveInteger(value.config, "maxContextTokens", 8192),
        maxOutputTokens: positiveInteger(value.config, "maxOutputTokens", 1024),
        maxDurationSeconds: positiveInteger(value.config, "maxDurationSeconds", 1800),
      }
    : undefined;
  return { id: text(value, "id"), config };
}

function optionalTaskTitle(objective: string): string {
  return objective.length > 96 ? `${objective.slice(0, 93)}...` : objective;
}

function ageSeconds(status: WorkflowStatusResult, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(status.updatedAt)) / 1000));
}

function isCompletedWorkflowStatus(status: WorkflowRunStatus): boolean {
  return status === "done" || status === "closed";
}

function heartbeatStatus(status: WorkflowStatusResult, staleAfterSeconds: number, now: Date): WorkflowReliabilityStatus {
  if (isCompletedWorkflowStatus(status.status)) return "done";
  if (status.status === "failed" || status.status === "cancelled") return "blocked";
  if (status.status === "checkpointed") return "waiting";
  return ageSeconds(status, now) > staleAfterSeconds ? "stalled" : "active";
}

function finalText(input: Record<string, unknown>): string {
  return text(input, "finalResponse", text(input, "answer"));
}

function evidenceGateStatus(value: unknown): string {
  return isRecord(value) && typeof value.status === "string" ? value.status : "missing";
}

function redactText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b(?:api[_-]?key|token|password|secret)\s*[=:]\s*[^,\s]+/gi, "[redacted-secret]");
}

function boundedSection(label: string, value: string | undefined): string {
  if (!value || value.trim() === "") return "";
  const redacted = redactText(value);
  const bounded = redacted.length > MAX_RESUME_SECTION_CHARS ? `${redacted.slice(0, MAX_RESUME_SECTION_CHARS)}\n[truncated ${redacted.length - MAX_RESUME_SECTION_CHARS} chars]` : redacted;
  return `\n${label}: ${bounded}`;
}

export async function createAnalysisWorkflowStart(root: string | undefined, input: Record<string, unknown>): Promise<AnalysisWorkflowStartResult> {
  const configuredRoot = resolveTinyChuPaths(root).root;
  const targetPath = text(input, "targetPath", ".");
  const resolvedTarget = resolvePathInsideRoot(configuredRoot, targetPath);
  if (!resolvedTarget) throw new Error(`Target path is outside configured root: ${targetPath}`);
  const objective = text(input, "objective", "Analyze repository with small local models");
  const tasks = new TaskStore({ root });
  const task = await tasks.create({
    title: optionalTaskTitle(objective),
    priority: "high",
    notes: ["analysis_workflow_start", `targetPath:${targetPath}`],
  });
  const workflow = await createWorkflow({
    root,
    workflowId: "analysis",
    objective,
    targetPath,
    workerAgent: workerAgent(input.workerAgent),
  });
  await tasks.update(task.id, { status: "in_progress", planRef: workflow.planRef, evidenceRefs: [workflow.stateRef] });
  const updatedTask = await tasks.get(task.id);
  if (!updatedTask) throw new Error(`Task not found after workflow start: ${task.id}`);
  return { task: updatedTask, workflow, nextCommand: workflow.nextCommand, requiredFirstTools: REQUIRED_FIRST_TOOLS };
}

export async function createWorkflowProgressHeartbeat(root: string | undefined, input: Record<string, unknown>): Promise<WorkflowProgressHeartbeatResult> {
  const runId = text(input, "runId");
  const status = await createWorkflowStatus({ root, runId });
  const now = new Date(text(input, "now", new Date().toISOString()));
  const state = heartbeatStatus(status, positiveInteger(input, "staleAfterSeconds", 900), now);
  const shouldContinue = state === "active" || state === "waiting" || state === "stalled";
  const statusLine = `${status.workflowId}:${status.runId} ${status.doneNodeCount} done, ${status.openNodeCount} open, state=${state}`;
  return { status: state, runId, shouldContinue, statusLine, sotRefs: [status.stateRef, status.planRef] };
}

export async function createWorkflowSotAudit(root: string | undefined, input: Record<string, unknown>): Promise<WorkflowSotAuditResult> {
  const runId = text(input, "runId");
  const status = await createWorkflowStatus({ root, runId });
  const answer = finalText(input);
  const diagnostics: WorkflowSotAuditResult["diagnostics"] = [
    ...(!isCompletedWorkflowStatus(status.status) ? [{ code: "workflow_not_done", severity: "error" as const, message: "Final response was attempted before the workflow source of truth reached done." }] : []),
    ...(!answer.includes(status.runId) || !answer.includes(status.stateRef) ? [{ code: "missing_sot_reference", severity: "error" as const, message: "Final response must cite the workflow run id and stateRef." }] : []),
    ...(evidenceGateStatus(input.evidenceGate) !== "pass" ? [{ code: "evidence_gate_not_passed", severity: "error" as const, message: "Evidence gate must pass before final response." }] : []),
  ];
  return { status: diagnostics.length === 0 ? "pass" : "fail", runId, diagnostics, sotRefs: [status.stateRef, status.planRef] };
}

export async function createPublicJobResumePacket(root: string | undefined, input: Record<string, unknown>): Promise<PublicJobResumePacketResult> {
  const dispatcher = new PublicDispatcher({ root });
  const id = text(input, "id");
  const job = await dispatcher.get(id);
  if (!job) throw new Error(`Public job not found: ${id}`);
  const resumePrompt = [
    boundedSection("Prompt", job.context.prompt).trimStart(),
    boundedSection("Checkpoint", job.context.checkpointSummary),
    boundedSection("Partial result", job.result),
    boundedSection("Return", job.contract.mustReturn.join(", ")),
  ].join("");
  return { jobId: job.id, status: job.status, resumePrompt, nextAction: { tool: "public_collect", input: { id: job.id } } };
}
