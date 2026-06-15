import path from "node:path";
import { appendJsonLine, readJsonFile, readJsonLines, writeJsonAtomic } from "./file-store.js";
import { resolveTinyChuPaths } from "./paths.js";
import { withWorkflowCheckpointLock } from "./workflow-lock.js";
import { workflowStageReportRef, writeWorkflowPlanProjection, writeWorkflowStageReport } from "./workflow-projection.js";
import type { WorkflowCheckpoint, WorkflowCheckpointInput, WorkflowCreateRunInput, WorkflowEvent, WorkflowNode, WorkflowNodeInput, WorkflowNodeStatus, WorkflowRun, WorkflowStoreOptions } from "./workflow-types.js";

const workflowRunSequences = new Map<string, number>();

function workflowStamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function workflowRunId(root: string | undefined, now: Date): string {
  const base = `W-${workflowStamp(now)}`;
  const sequenceKey = `${resolveTinyChuPaths(root).workflowRunsDir}\0${base}`;
  const sequence = workflowRunSequences.get(sequenceKey) ?? 0;
  workflowRunSequences.set(sequenceKey, sequence + 1);
  return sequence === 0 ? base : `${base}-${sequence.toString(36).padStart(4, "0")}`;
}

function assertWorkflowRunId(runId: string): void {
  if (!/^W-[A-Za-z0-9_-]+$/.test(runId)) throw new Error(`Invalid workflow run id: ${runId}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runFile(root: string | undefined, runId: string): string {
  assertWorkflowRunId(runId);
  return path.join(resolveTinyChuPaths(root).workflowRunsDir, `${runId}.json`);
}

function eventFile(root: string | undefined, runId: string): string {
  assertWorkflowRunId(runId);
  return path.join(resolveTinyChuPaths(root).workflowRunsDir, `${runId}.events.jsonl`);
}

function stateRef(runId: string): string {
  return `.tiny/workflows/runs/${runId}.json`;
}

function planRef(runId: string): string {
  return `.tiny/plans/${runId}.md`;
}

function nodeStatus(input: WorkflowNodeInput): WorkflowNodeStatus {
  return (input.dependencies ?? []).length === 0 ? "ready" : "blocked";
}

function normalizeNode(input: WorkflowNodeInput, now: string): WorkflowNode {
  return {
    nodeId: input.nodeId,
    type: input.type,
    title: input.title,
    status: nodeStatus(input),
    dependencies: [...(input.dependencies ?? [])].sort(),
    createdAt: now,
    updatedAt: now,
  };
}

function firstReadyNode(nodes: readonly WorkflowNode[]): string | undefined {
  return nodes.find((node) => node.status === "ready")?.nodeId;
}

function nextCheckpointSequence(checkpoints: readonly WorkflowCheckpoint[]): number {
  return checkpoints.reduce((max, checkpoint) => Math.max(max, checkpoint.sequence), 0) + 1;
}

function updateNode(nodes: readonly WorkflowNode[], nodeId: string, status: WorkflowNodeStatus, updatedAt: string): readonly WorkflowNode[] {
  let found = false;
  const updated = nodes.map((node) => {
    if (node.nodeId !== nodeId) return node;
    found = true;
    return { ...node, status, updatedAt };
  });
  if (!found) throw new Error(`Workflow node not found: ${nodeId}`);
  return updated;
}

function dependenciesDone(node: WorkflowNode, doneNodeIds: ReadonlySet<string>): boolean {
  return node.dependencies.every((dependency) => doneNodeIds.has(dependency));
}

function unlockDependencyReadyNodes(nodes: readonly WorkflowNode[], updatedAt: string): readonly WorkflowNode[] {
  const doneNodeIds = new Set(nodes.filter((node) => node.status === "done").map((node) => node.nodeId));
  return nodes.map((node) => {
    if (node.status !== "blocked" || !dependenciesDone(node, doneNodeIds)) return node;
    return { ...node, status: "ready", updatedAt };
  });
}

function nodesAfterCheckpoint(run: WorkflowRun, checkpoint: WorkflowCheckpoint): readonly WorkflowNode[] {
  const updated = updateNode(run.nodes, checkpoint.nodeId, checkpoint.status, checkpoint.createdAt);
  return checkpoint.status === "done" ? unlockDependencyReadyNodes(updated, checkpoint.createdAt) : updated;
}

function runStatusAfterCheckpoint(nodes: readonly WorkflowNode[], checkpoint: WorkflowCheckpoint): WorkflowRun["status"] {
  if (checkpoint.status !== "done") return checkpoint.status;
  return nodes.every((node) => node.status === "done") ? "done" : "running";
}

function currentNodeAfterCheckpoint(nodes: readonly WorkflowNode[], checkpoint: WorkflowCheckpoint): string | undefined {
  return checkpoint.status === "done" ? firstReadyNode(nodes) : checkpoint.nodeId;
}

function appendCheckpoint(run: WorkflowRun, checkpoint: WorkflowCheckpoint): WorkflowRun {
  const nodes = nodesAfterCheckpoint(run, checkpoint);
  return {
    ...run,
    status: runStatusAfterCheckpoint(nodes, checkpoint),
    currentNodeId: currentNodeAfterCheckpoint(nodes, checkpoint),
    nodes,
    checkpoints: [...run.checkpoints, checkpoint].sort((left, right) => left.sequence - right.sequence),
    updatedAt: checkpoint.createdAt,
  };
}

function assertCheckpointTarget(run: WorkflowRun, nodeId: string): void {
  const node = run.nodes.find((item) => item.nodeId === nodeId);
  if (!node) throw new Error(`Workflow node not found: ${nodeId}`);
  if (run.currentNodeId !== nodeId) throw new Error(`Workflow checkpoint target must be the current node: ${nodeId}`);
  if (node.status === "blocked") throw new Error(`Workflow checkpoint target is blocked by dependencies: ${nodeId}`);
}

function isWorkflowRun(value: unknown): value is WorkflowRun {
  return isRecord(value)
    && typeof value.runId === "string"
    && typeof value.workflowId === "string"
    && typeof value.objective === "string"
    && typeof value.status === "string"
    && typeof value.planRef === "string"
    && typeof value.stateRef === "string"
    && Array.isArray(value.nodes)
    && Array.isArray(value.checkpoints)
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string";
}

export class WorkflowStore {
  readonly root?: string;
  private readonly now: () => Date;

  constructor(options: WorkflowStoreOptions = {}) {
    this.root = options.root;
    this.now = options.now ?? (() => new Date());
  }

  async createRun(input: WorkflowCreateRunInput): Promise<WorkflowRun> {
    const now = this.now();
    const iso = now.toISOString();
    const runId = workflowRunId(this.root, now);
    const nodes = input.nodes.map((node) => normalizeNode(node, iso));
    const run: WorkflowRun = {
      runId,
      workflowId: input.workflowId,
      objective: input.objective,
      targetPath: input.targetPath,
      workerAgent: input.workerAgent,
      status: "ready",
      currentNodeId: firstReadyNode(nodes),
      planRef: planRef(runId),
      stateRef: stateRef(runId),
      nodes,
      checkpoints: [],
      createdAt: iso,
      updatedAt: iso,
    };
    await writeJsonAtomic(runFile(this.root, runId), run);
    await writeWorkflowPlanProjection(this.root, run);
    await appendJsonLine(eventFile(this.root, runId), {
      sequence: 1,
      type: "run_created",
      runId,
      status: run.status,
      createdAt: iso,
    } satisfies WorkflowEvent);
    return run;
  }

  async getRun(runId: string): Promise<WorkflowRun | undefined> {
    const missing = Symbol("missing");
    const file = runFile(this.root, runId);
    const value = await readJsonFile<unknown | typeof missing>(file, missing);
    if (value === missing) return undefined;
    if (!isWorkflowRun(value) || value.runId !== runId) throw new Error(`Workflow state run id mismatch in ${file}`);
    return value;
  }

  async readEvents(runId: string): Promise<WorkflowEvent[]> {
    return readJsonLines<WorkflowEvent>(eventFile(this.root, runId), []);
  }

  async checkpoint(input: WorkflowCheckpointInput): Promise<WorkflowCheckpoint> {
    return withWorkflowCheckpointLock(this.root, input.runId, async () => {
      const current = await this.getRun(input.runId);
      if (!current) throw new Error(`Workflow run not found: ${input.runId}`);
      assertCheckpointTarget(current, input.nodeId);
      const events = await this.readEvents(input.runId);
      const createdAt = this.now().toISOString();
      const sequence = nextCheckpointSequence(current.checkpoints);
      const checkpoint: WorkflowCheckpoint = {
        sequence,
        nodeId: input.nodeId,
        summary: input.summary,
        status: input.status ?? "checkpointed",
        nextSteps: input.nextSteps ?? [],
        evidenceRefs: input.evidenceRefs ?? [],
        stageReportRef: workflowStageReportRef(input.runId, { sequence, nodeId: input.nodeId }),
        createdAt,
      };
      const updated = appendCheckpoint(current, checkpoint);
      await appendJsonLine(eventFile(this.root, input.runId), {
        sequence: events.length + 1,
        type: "checkpoint_created",
        runId: input.runId,
        nodeId: input.nodeId,
        status: checkpoint.status,
        summary: checkpoint.summary,
        createdAt,
      } satisfies WorkflowEvent);
      await writeJsonAtomic(runFile(this.root, input.runId), updated);
      await writeWorkflowStageReport(this.root, updated, checkpoint);
      await writeWorkflowPlanProjection(this.root, updated);
      return checkpoint;
    });
  }
}
