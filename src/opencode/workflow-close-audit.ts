import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { resolveTinyChuPaths } from "../state/paths.js";
import { WorkflowStore } from "../state/workflow-store.js";
import type { WorkflowAuditFinding, WorkflowAuditInput, WorkflowAuditResult, WorkflowCloseInput, WorkflowCloseResult } from "../state/workflow-close-audit-types.js";
import type { WorkflowRun } from "../state/workflow-types.js";

const DEFAULT_AUDIT_STALE_AFTER_SECONDS = 900;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function evidenceGateStatus(value: unknown): string {
  return isRecord(value) && typeof value.status === "string" ? value.status : "missing";
}

function evidenceGatePassed(value: unknown): boolean {
  return evidenceGateStatus(value) === "pass";
}

function finding(input: WorkflowAuditFinding): WorkflowAuditFinding {
  return input;
}

function workflowStateRef(runId: string): string {
  return `.tiny/workflows/runs/${runId}.json`;
}

function isTerminalWorkflowStatus(status: WorkflowRun["status"]): boolean {
  return status === "closed" || status === "failed" || status === "cancelled";
}

function auditNow(input: WorkflowAuditInput): Date {
  return new Date(input.now ?? new Date().toISOString());
}

function auditStaleAfterSeconds(input: WorkflowAuditInput): number {
  return input.staleAfterSeconds && Number.isInteger(input.staleAfterSeconds) && input.staleAfterSeconds > 0 ? input.staleAfterSeconds : DEFAULT_AUDIT_STALE_AFTER_SECONDS;
}

function runAgeSeconds(run: WorkflowRun, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(run.updatedAt)) / 1000));
}

function checkpointGapFinding(run: WorkflowRun): WorkflowAuditFinding | undefined {
  const sequences = run.checkpoints.map((checkpoint) => checkpoint.sequence).sort((left, right) => left - right);
  for (let index = 0; index < sequences.length; index += 1) {
    if (sequences[index] !== index + 1) {
      return finding({
        code: "checkpoint_gap",
        severity: "error",
        message: `Workflow checkpoint sequences must be contiguous for ${run.runId}.`,
        ref: run.stateRef,
        remediationToolCalls: [{ tool: "workflow_status", input: { runId: run.runId } }],
      });
    }
  }
  return undefined;
}

function missingEvidenceFindings(run: WorkflowRun): readonly WorkflowAuditFinding[] {
  return run.checkpoints
    .filter((checkpoint) => checkpoint.status === "done" && checkpoint.evidenceRefs.length === 0)
    .map((checkpoint) => finding({
      code: "missing_evidence_ref",
      severity: "error",
      message: `Done checkpoint ${checkpoint.nodeId} has no evidenceRefs.`,
      ref: checkpoint.stageReportRef ?? run.stateRef,
      remediationToolCalls: [{
        tool: "workflow_checkpoint",
        input: { runId: run.runId, nodeId: checkpoint.nodeId, status: "done", evidenceRefs: ["<evidence-ref>"] },
      }],
    }));
}

function staleRunFinding(run: WorkflowRun, now: Date, staleAfterSeconds: number): WorkflowAuditFinding | undefined {
  if (isTerminalWorkflowStatus(run.status) || runAgeSeconds(run, now) <= staleAfterSeconds) return undefined;
  return finding({
    code: "stale_run",
    severity: "warning",
    message: `Workflow run has not changed within ${staleAfterSeconds} seconds.`,
    ref: run.stateRef,
    remediationToolCalls: [{ tool: "workflow_progress_heartbeat", input: { runId: run.runId } }],
  });
}

function finalResponseFinding(run: WorkflowRun, finalResponse: string | undefined): WorkflowAuditFinding | undefined {
  if (!finalResponse || finalResponse.includes(run.stateRef)) return undefined;
  return finding({
    code: "final_response_missing_state_ref",
    severity: "error",
    message: "Final response must cite the workflow stateRef before completion is claimed.",
    ref: run.stateRef,
    remediationToolCalls: [{ tool: "workflow_sot_audit", input: { runId: run.runId } }],
  });
}

function workflowNotDoneFinding(run: WorkflowRun): WorkflowAuditFinding | undefined {
  if (run.status === "done" || run.status === "closed") return undefined;
  return finding({
    code: "workflow_not_done",
    severity: "error",
    message: "Workflow run must have all nodes done before close.",
    ref: run.stateRef,
    remediationToolCalls: [{ tool: "workflow_next", input: { runId: run.runId } }],
  });
}

async function fileStat(file: string): Promise<{ readonly mtimeMs: number } | undefined> {
  try {
    return await stat(file);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function sortedMarkdownFiles(dir: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter((entry) => entry.endsWith(".md")).sort();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

async function projectionDriftFinding(root: string | undefined, run: WorkflowRun): Promise<WorkflowAuditFinding | undefined> {
  const paths = resolveTinyChuPaths(root);
  const state = await fileStat(path.join(paths.root, run.stateRef));
  const projection = await fileStat(path.join(paths.root, run.planRef));
  if (!state || !projection || projection.mtimeMs <= state.mtimeMs) return undefined;
  return finding({
    code: "projection_newer_than_json",
    severity: "warning",
    message: "Workflow Markdown projection is newer than the JSON source of truth; do not promote projection content to state.",
    ref: run.planRef,
    remediationToolCalls: [{ tool: "workflow_status", input: { runId: run.runId } }],
  });
}

async function orphanReportFindings(root: string | undefined, run: WorkflowRun): Promise<readonly WorkflowAuditFinding[]> {
  const reportDir = path.join(resolveTinyChuPaths(root).workflowReportsDir, run.runId);
  const expected = new Set(run.checkpoints.map((checkpoint) => checkpoint.stageReportRef).filter((ref): ref is string => typeof ref === "string").map((ref) => path.basename(ref)));
  const files = await sortedMarkdownFiles(reportDir);
  return files
    .filter((file) => !expected.has(file))
    .map((file) => finding({
      code: "orphan_report",
      severity: "warning",
      message: `Workflow report ${file} has no matching checkpoint stageReportRef.`,
      ref: `.tiny/workflows/reports/${run.runId}/${file}`,
      remediationToolCalls: [{ tool: "workflow_audit", input: { runId: run.runId } }],
    }));
}

async function auditRun(root: string | undefined, run: WorkflowRun, input: WorkflowAuditInput): Promise<readonly WorkflowAuditFinding[]> {
  const findings: WorkflowAuditFinding[] = [];
  const gap = checkpointGapFinding(run);
  const stale = staleRunFinding(run, auditNow(input), auditStaleAfterSeconds(input));
  const finalResponse = finalResponseFinding(run, input.finalResponse);
  const projection = await projectionDriftFinding(root, run);
  findings.push(...missingEvidenceFindings(run));
  if (gap) findings.push(gap);
  if (stale) findings.push(stale);
  if (finalResponse) findings.push(finalResponse);
  findings.push(...await orphanReportFindings(root, run));
  if (projection) findings.push(projection);
  return findings.sort((left, right) => `${left.code}:${left.ref ?? ""}`.localeCompare(`${right.code}:${right.ref ?? ""}`));
}

async function runIdsForAudit(root: string | undefined, requestedRunId: string | undefined): Promise<readonly string[]> {
  if (requestedRunId) return [requestedRunId];
  try {
    const files = await readdir(resolveTinyChuPaths(root).workflowRunsDir);
    return files.filter((file) => file.endsWith(".json") && !file.endsWith(".events.json")).map((file) => file.slice(0, -".json".length)).sort();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

function sotRefsForRuns(runs: readonly WorkflowRun[]): readonly string[] {
  return runs.flatMap((run) => [run.stateRef, run.planRef]).sort();
}

function hasBlockingFindings(findings: readonly WorkflowAuditFinding[]): boolean {
  return findings.some((item) => item.severity === "error");
}

export async function createWorkflowAudit(root: string | undefined, input: WorkflowAuditInput): Promise<WorkflowAuditResult> {
  const store = new WorkflowStore({ root });
  const runIds = await runIdsForAudit(root, input.runId);
  const runs: WorkflowRun[] = [];
  const findings: WorkflowAuditFinding[] = [];
  for (const runId of runIds) {
    const run = await store.getRun(runId);
    if (!run) throw new Error(`Workflow run not found: ${runId}`);
    runs.push(run);
    findings.push(...await auditRun(root, run, input));
  }
  return { status: hasBlockingFindings(findings) ? "fail" : "pass", runId: input.runId, findings, sotRefs: sotRefsForRuns(runs) };
}

export async function createWorkflowClose(root: string | undefined, input: WorkflowCloseInput): Promise<WorkflowCloseResult> {
  const audit = await createWorkflowAudit(root, { root, runId: input.runId });
  const store = new WorkflowStore({ root });
  const run = await store.getRun(input.runId);
  if (!run) throw new Error(`Workflow run not found: ${input.runId}`);
  const statusFinding = workflowNotDoneFinding(run);
  const gateFinding = evidenceGatePassed(input.evidenceGate) ? undefined : finding({
    code: "missing_evidence_ref",
    severity: "error",
    message: "Evidence gate must pass before workflow close.",
    ref: workflowStateRef(input.runId),
    remediationToolCalls: [{ tool: "evidence_gate", input: { runId: input.runId } }],
  });
  const closeFindings = [statusFinding, ...audit.findings, gateFinding].filter((item): item is WorkflowAuditFinding => item !== undefined);
  const blockingFindings = closeFindings.filter((item) => item.severity === "error");
  if (blockingFindings.length > 0) return { status: "rejected", runId: input.runId, findings: blockingFindings, sotRefs: audit.sotRefs };
  const closed = await store.closeRun({ runId: input.runId, summary: input.summary });
  return { status: "closed", runId: closed.runId, closedAt: closed.closedAt, findings: closeFindings, sotRefs: [closed.stateRef, closed.planRef] };
}
