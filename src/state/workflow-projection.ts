import path from "node:path";
import { writeTextAtomic } from "./file-store.js";
import { resolveTinyChuPaths } from "./paths.js";
import type { WorkflowCheckpoint, WorkflowRun } from "./workflow-types.js";

function commandLine(tool: string, runId: string): string {
  return `${tool} ${JSON.stringify({ runId })}`;
}

function markdownList(values: readonly string[], emptyText: string): string {
  if (values.length === 0) return `- ${emptyText}`;
  return values.map((value) => `- ${value}`).join("\n");
}

function markdownChecklist(run: WorkflowRun): string {
  return run.nodes
    .map((node) => {
      const checked = node.status === "done" || node.status === "checkpointed" ? "x" : " ";
      const title = node.title ? ` - ${node.title}` : "";
      const dependencies = node.dependencies.length === 0 ? "none" : node.dependencies.join(", ");
      return `- [${checked}] ${node.nodeId}${title} (${node.status}; dependencies: ${dependencies})`;
    })
    .join("\n");
}

function latestCheckpoint(run: WorkflowRun): WorkflowCheckpoint | undefined {
  return [...run.checkpoints].sort((left, right) => right.sequence - left.sequence)[0];
}

function renderCheckpoint(checkpoint: WorkflowCheckpoint | undefined): string {
  if (!checkpoint) return "No checkpoints recorded.";
  const stageReport = checkpoint.stageReportRef ? `- stageReportRef: \`${checkpoint.stageReportRef}\`\n` : "";
  return [
    `- sequence: ${checkpoint.sequence}`,
    `- nodeId: ${checkpoint.nodeId}`,
    `- status: ${checkpoint.status}`,
    `- summary: ${checkpoint.summary}`,
    stageReport.trimEnd(),
    "",
    "### Evidence refs",
    markdownList(checkpoint.evidenceRefs, "No evidence refs recorded."),
    "",
    "### Next steps",
    markdownList(checkpoint.nextSteps, "No next steps recorded."),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function renderWorkflowPlanProjection(run: WorkflowRun): string {
  return `${[
    `# Workflow Plan Projection: ${run.workflowId}`,
    "",
    "Markdown projection generated from the JSON source of truth. Regenerate this file from workflow state instead of editing it as authority.",
    "",
    `- JSON source of truth: \`${run.stateRef}\``,
    `- runId: \`${run.runId}\``,
    `- stateRef: \`${run.stateRef}\``,
    `- status: \`${run.status}\``,
    `- currentNodeId: \`${run.currentNodeId ?? "none"}\``,
    `- Resume command: \`${commandLine("workflow_resume_packet", run.runId)}\``,
    `- Re-entry command: \`${commandLine("workflow_next", run.runId)}\``,
    "",
    "## Phase checklist",
    "",
    markdownChecklist(run),
    "",
    "## Latest checkpoint",
    "",
    renderCheckpoint(latestCheckpoint(run)),
    "",
  ].join("\n")}\n`;
}

function renderStageReport(run: WorkflowRun, checkpoint: WorkflowCheckpoint): string {
  return `${[
    `# Workflow Stage Report: ${checkpoint.nodeId}`,
    "",
    `- runId: \`${run.runId}\``,
    `- nodeId: \`${checkpoint.nodeId}\``,
    `- stateRef: \`${run.stateRef}\``,
    `- resume command: \`${commandLine("workflow_resume_packet", run.runId)}\``,
    "",
    "## Summary",
    "",
    checkpoint.summary,
    "",
    "## Evidence refs",
    "",
    markdownList(checkpoint.evidenceRefs, "No evidence refs recorded."),
    "",
    "## Next steps",
    "",
    markdownList(checkpoint.nextSteps, "No next steps recorded."),
    "",
  ].join("\n")}\n`;
}

function absoluteRef(root: string | undefined, ref: string): string {
  return path.join(resolveTinyChuPaths(root).root, ref);
}

function assertWorkflowRunId(runId: string): void {
  if (!/^W-[A-Za-z0-9_-]+$/.test(runId)) throw new Error(`Invalid workflow run id: ${runId}`);
}

function workflowPlanProjectionRef(runId: string): string {
  assertWorkflowRunId(runId);
  return `.tiny/plans/${runId}.md`;
}

function safeNodeId(nodeId: string): string {
  const safe = nodeId.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || "node";
}

export function workflowStageReportRef(runId: string, checkpoint: Pick<WorkflowCheckpoint, "sequence" | "nodeId">): string {
  assertWorkflowRunId(runId);
  const sequence = checkpoint.sequence.toString().padStart(3, "0");
  return `.tiny/workflows/reports/${runId}/${sequence}-${safeNodeId(checkpoint.nodeId)}.md`;
}

export async function writeWorkflowPlanProjection(root: string | undefined, run: WorkflowRun): Promise<void> {
  await writeTextAtomic(absoluteRef(root, workflowPlanProjectionRef(run.runId)), renderWorkflowPlanProjection({ ...run, planRef: workflowPlanProjectionRef(run.runId) }));
}

export async function writeWorkflowStageReport(root: string | undefined, run: WorkflowRun, checkpoint: WorkflowCheckpoint): Promise<void> {
  await writeTextAtomic(absoluteRef(root, workflowStageReportRef(run.runId, checkpoint)), renderStageReport(run, checkpoint));
}
