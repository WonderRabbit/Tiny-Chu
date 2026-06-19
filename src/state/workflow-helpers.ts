import { createWorkflowDefinitionNodes } from "./workflow-definitions.js";
import { resolveTinyChuPaths } from "./paths.js";
import { resolvePathInsideRoot } from "./path-safety.js";
import { WorkflowStore } from "./workflow-store.js";
import type {
  WorkflowCheckpoint,
  WorkflowCheckpointRequest,
  WorkflowContextFit,
  WorkflowContextFitSource,
  WorkflowCreateInput,
  WorkflowCreateResult,
  WorkflowNextPacket,
  WorkflowNextPacketInput,
  WorkflowNodeInput,
  WorkflowPacketDiagnostic,
  WorkflowPacketFitInput,
  WorkflowPacketFitResult,
  WorkflowPacketInput,
  WorkflowPacketScopeKind,
  WorkflowResumePacket,
  WorkflowResumePacketInput,
  WorkflowRun,
  WorkflowSplitCandidate,
  WorkflowStatusInput,
  WorkflowStatusResult,
  WorkflowStopPoint,
  WorkflowToolCommand,
  WorkflowWorkerAgent,
  WorkflowWorkerExecution,
} from "./workflow-types.js";

const DEFAULT_MAX_CONTEXT_TOKENS = 8192;
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;
const STATIC_PACKET_OVERHEAD_TOKENS = 384;
const MAX_EVIDENCE_REFS_PER_PACKET = 12;

const DEFAULT_NODES: readonly WorkflowNodeInput[] = [
  { nodeId: "workflow_init", type: "init", title: "Initialize workflow" },
];

function nextCommand(runId: string): WorkflowToolCommand {
  return { tool: "workflow_next", input: { runId } };
}

function resumeCommand(runId: string): WorkflowToolCommand {
  return { tool: "workflow_resume_packet", input: { runId } };
}

function currentStopPoint(run: WorkflowRun, latestCheckpoint: WorkflowCheckpoint | undefined): WorkflowStopPoint {
  if (!latestCheckpoint) return { nodeId: run.currentNodeId, nextSteps: [] };
  if (latestCheckpoint.status === "done") return { nodeId: run.currentNodeId, nextSteps: [] };
  return { nodeId: latestCheckpoint.nodeId, summary: latestCheckpoint.summary, nextSteps: latestCheckpoint.nextSteps };
}

async function requireRun(root: string | undefined, runId: string): Promise<WorkflowStatusResult> {
  const store = new WorkflowStore({ root });
  const run = await store.getRun(runId);
  if (!run) throw new Error(`Workflow run not found: ${runId}`);
  const latestCheckpoint = [...run.checkpoints].sort((left, right) => right.sequence - left.sequence)[0];
  const doneNodeCount = run.nodes.filter((node) => node.status === "done").length;
  const openNodeCount = run.nodes.length - doneNodeCount;
  return { ...run, latestCheckpoint, currentStopPoint: currentStopPoint(run, latestCheckpoint), openNodeCount, doneNodeCount, resumeCommand: resumeCommand(run.runId) };
}

export async function createWorkflow(input: WorkflowCreateInput): Promise<WorkflowCreateResult> {
  if (input.targetPath && !resolvePathInsideRoot(resolveTinyChuPaths(input.root).root, input.targetPath)) {
    throw new Error(`Target path is outside configured root: ${input.targetPath}`);
  }
  const store = new WorkflowStore({ root: input.root });
  const run = await store.createRun({
    workflowId: input.workflowId,
    objective: input.objective,
    targetPath: input.targetPath,
    workerAgent: input.workerAgent,
    nodes: input.nodes ?? defaultNodes(input.workflowId),
  });
  return { ...run, nextCommand: nextCommand(run.runId) };
}

export async function createWorkflowStatus(input: WorkflowStatusInput): Promise<WorkflowStatusResult> {
  return requireRun(input.root, input.runId);
}

export async function createWorkflowCheckpoint(input: WorkflowCheckpointRequest): Promise<WorkflowCheckpoint> {
  const store = new WorkflowStore({ root: input.root });
  return store.checkpoint(input);
}

export async function createWorkflowResumePacket(input: WorkflowResumePacketInput): Promise<WorkflowResumePacket> {
  const status = await createWorkflowStatus(input);
  return {
    kind: "agent_packet",
    runId: status.runId,
    workflowId: status.workflowId,
    objective: status.objective,
    nodeId: status.currentStopPoint.nodeId,
    planRef: status.planRef,
    stateRef: status.stateRef,
    latestCheckpoint: status.latestCheckpoint,
    stopCondition: "return evidence and checkpoint before continuing",
    nextAction: { command: nextCommand(status.runId) },
    workerExecution: serialWorkerExecution(),
  };
}

export async function createWorkflowNextPacket(input: WorkflowNextPacketInput): Promise<WorkflowNextPacket> {
  const status = await createWorkflowStatus(input);
  if (status.status === "done" || status.status === "closed") return { kind: "done", runId: status.runId, reason: "Workflow run is already done." };
  if (!status.currentStopPoint.nodeId) return { kind: "blocked", runId: status.runId, reason: "No current workflow node is available." };
  return { kind: "agent_packet", runId: status.runId, packet: await createWorkflowResumePacket(input) };
}

export function createWorkflowPacketFitCheck(input: WorkflowPacketFitInput): WorkflowPacketFitResult {
  const contextFit = buildContextFit(input.workerAgent, input.packet);
  const diagnostics = buildDiagnostics(input.packet, contextFit);
  const splitCandidates = buildSplitCandidates(input.packet);
  const fits = contextFit.estimatedTokens <= contextFit.usableContextTokens && diagnostics.every((diagnostic) => diagnostic.severity === "info");
  return {
    fits,
    requiredAction: fits ? "run" : "split",
    contextFit,
    workerExecution: serialWorkerExecution(),
    diagnostics,
    splitCandidates: fits ? [] : splitCandidates,
  };
}

function serialWorkerExecution(): WorkflowWorkerExecution {
  return { parallel: false, maxConcurrentWorkers: 1 };
}

function defaultNodes(workflowId: string): readonly WorkflowNodeInput[] {
  return workflowId === "analysis" ? createWorkflowDefinitionNodes(workflowId) : DEFAULT_NODES;
}

function positiveInteger(value: number | undefined): number | undefined {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : undefined;
}

function maxContext(workerAgent: WorkflowWorkerAgent | undefined): { readonly tokens: number; readonly source: WorkflowContextFitSource } {
  const configured = positiveInteger(workerAgent?.config?.maxContextTokens);
  return configured ? { tokens: configured, source: "workerAgent.config.maxContextTokens" } : { tokens: DEFAULT_MAX_CONTEXT_TOKENS, source: "default" };
}

function buildContextFit(workerAgent: WorkflowWorkerAgent | undefined, packet: WorkflowPacketInput): WorkflowContextFit {
  const context = maxContext(workerAgent);
  const maxOutputTokens = positiveInteger(workerAgent?.config?.maxOutputTokens) ?? DEFAULT_MAX_OUTPUT_TOKENS;
  return {
    maxContextTokens: context.tokens,
    maxContextSource: context.source,
    maxOutputTokens,
    usableContextTokens: Math.max(1, context.tokens - maxOutputTokens),
    estimatedTokens: estimatePacketTokens(packet),
    tokenEstimateMode: "static",
  };
}

function estimatePacketTokens(packet: WorkflowPacketInput): number {
  return (
    STATIC_PACKET_OVERHEAD_TOKENS +
    textTokens(packet.objective) +
    listTokens(packet.scopePaths) +
    listTokens(packet.evidenceRefs) +
    listTokens(packet.allowedTools) +
    textTokens(packet.verification) +
    textTokens(packet.stopCondition) +
    listTokens(packet.requiredSteps)
  );
}

function textTokens(value: string | undefined): number {
  return value ? Math.ceil(value.length / 4) : 0;
}

function listTokens(values: readonly string[] | undefined): number {
  return values?.reduce((total, value) => total + textTokens(value) + 4, 0) ?? 0;
}

function buildDiagnostics(packet: WorkflowPacketInput, contextFit: WorkflowContextFit): readonly WorkflowPacketDiagnostic[] {
  const diagnostics: WorkflowPacketDiagnostic[] = [];
  const scopeKinds = new Set((packet.scopePaths ?? []).map(scopeKind));
  if (scopeKinds.has("ui") && scopeKinds.has("backend")) {
    diagnostics.push({ code: "mixed_ui_backend_scope", severity: "warning", message: "UI and backend paths must be split for small workers." });
  }
  if ((packet.evidenceRefs ?? []).length > MAX_EVIDENCE_REFS_PER_PACKET) {
    diagnostics.push({ code: "too_many_evidence_refs", severity: "warning", message: "Evidence refs exceed the static packet limit." });
  }
  if (contextFit.estimatedTokens > contextFit.usableContextTokens) {
    diagnostics.push({ code: "context_window_exceeded", severity: "error", message: "Estimated packet tokens exceed usable worker context." });
  }
  return diagnostics.length === 0 ? [{ code: "fits_static_context", severity: "info", message: "Packet fits the static context estimate." }] : diagnostics;
}

function buildSplitCandidates(packet: WorkflowPacketInput): readonly WorkflowSplitCandidate[] {
  const scopePaths = packet.scopePaths ?? [];
  const evidenceRefs = packet.evidenceRefs ?? [];
  const uiPaths = pathsFor(scopePaths, "ui");
  const backendPaths = pathsFor(scopePaths, "backend");
  const candidates: WorkflowSplitCandidate[] = [];
  if (uiPaths.length > 0) candidates.push(splitCandidate("ui", uiPaths, evidenceRefs, "Separate UI/page work from backend flow work."));
  if (backendPaths.length > 0) candidates.push(splitCandidate("backend", backendPaths, evidenceRefs, "Separate backend/API/DAO/SQL work from UI work."));
  return candidates.length > 0 ? candidates : [splitCandidate("general", scopePaths, evidenceRefs, "Split the packet into a smaller general work item.")];
}

function splitCandidate(scopeKindValue: WorkflowPacketScopeKind, scopePaths: readonly string[], evidenceRefs: readonly string[], reason: string): WorkflowSplitCandidate {
  return { scopeKind: scopeKindValue, scopePaths, evidenceRefs, reason };
}

function pathsFor(paths: readonly string[], target: WorkflowPacketScopeKind): readonly string[] {
  return paths.filter((path) => scopeKind(path) === target);
}

function scopeKind(filePath: string): WorkflowPacketScopeKind {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".sql") || lower.includes("/dao") || lower.includes("/api/") || lower.includes("/server/") || lower.includes("/service")) return "backend";
  if (lower.endsWith(".tsx") || lower.endsWith(".jsx") || lower.includes("/app/") || lower.includes("/pages/") || lower.includes("/ui/")) return "ui";
  return "general";
}
