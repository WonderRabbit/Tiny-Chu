export type WorkflowRunStatus = "ready" | "running" | "checkpointed" | "blocked" | "done" | "failed" | "cancelled";

export type WorkflowNodeStatus = "blocked" | "ready" | "running" | "checkpointed" | "done" | "failed" | "cancelled";

export type WorkflowEventType = "run_created" | "checkpoint_created";

export type WorkflowPacketKind = "agent_packet" | "split_required" | "command" | "gate" | "blocked" | "done";

export type WorkflowPacketRequiredAction = "run" | "split";

export type WorkflowPacketScopeKind = "ui" | "backend" | "general";

export type WorkflowPacketDiagnosticSeverity = "info" | "warning" | "error";

export type WorkflowContextFitSource = "workerAgent.config.maxContextTokens" | "default";

export type WorkflowTokenEstimateMode = "static";

export interface WorkflowNodeInput {
  readonly nodeId: string;
  readonly type?: string;
  readonly title?: string;
  readonly dependencies?: readonly string[];
}

export interface WorkflowDefinitionPhase extends WorkflowNodeInput {
  readonly description: string;
  readonly expectedOutputs: readonly string[];
}

export interface WorkflowDefinition {
  readonly workflowId: string;
  readonly title: string;
  readonly description: string;
  readonly phases: readonly WorkflowDefinitionPhase[];
}

export interface WorkflowWorkerAgentConfig {
  readonly maxContextTokens?: number;
  readonly maxOutputTokens?: number;
  readonly maxDurationSeconds?: number;
}

export interface WorkflowWorkerAgent {
  readonly id?: string;
  readonly config?: WorkflowWorkerAgentConfig;
}

export interface WorkflowNode {
  readonly nodeId: string;
  readonly type?: string;
  readonly title?: string;
  readonly status: WorkflowNodeStatus;
  readonly dependencies: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkflowCheckpoint {
  readonly sequence: number;
  readonly nodeId: string;
  readonly summary: string;
  readonly status: WorkflowNodeStatus;
  readonly nextSteps: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly stageReportRef?: string;
  readonly createdAt: string;
}

export interface WorkflowRun {
  readonly runId: string;
  readonly workflowId: string;
  readonly objective: string;
  readonly targetPath?: string;
  readonly workerAgent?: WorkflowWorkerAgent;
  readonly status: WorkflowRunStatus;
  readonly currentNodeId?: string;
  readonly planRef: string;
  readonly stateRef: string;
  readonly nodes: readonly WorkflowNode[];
  readonly checkpoints: readonly WorkflowCheckpoint[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkflowEvent {
  readonly sequence: number;
  readonly type: WorkflowEventType;
  readonly runId: string;
  readonly nodeId?: string;
  readonly status?: WorkflowRunStatus | WorkflowNodeStatus;
  readonly summary?: string;
  readonly createdAt: string;
}

export interface WorkflowCreateRunInput {
  readonly workflowId: string;
  readonly objective: string;
  readonly targetPath?: string;
  readonly workerAgent?: WorkflowWorkerAgent;
  readonly nodes: readonly WorkflowNodeInput[];
}

export interface WorkflowCheckpointInput {
  readonly runId: string;
  readonly nodeId: string;
  readonly summary: string;
  readonly status?: WorkflowNodeStatus;
  readonly nextSteps?: readonly string[];
  readonly evidenceRefs?: readonly string[];
}

export interface WorkflowCheckpointRequest extends WorkflowCheckpointInput {
  readonly root?: string;
}

export interface WorkflowStoreOptions {
  readonly root?: string;
  readonly now?: () => Date;
}

export interface WorkflowToolCommand {
  readonly tool: string;
  readonly input: {
    readonly runId: string;
  };
}

export interface WorkflowCreateInput {
  readonly root?: string;
  readonly workflowId: string;
  readonly objective: string;
  readonly targetPath?: string;
  readonly workerAgent?: WorkflowWorkerAgent;
  readonly nodes?: readonly WorkflowNodeInput[];
}

export interface WorkflowCreateResult extends WorkflowRun {
  readonly nextCommand: WorkflowToolCommand;
}

export interface WorkflowStatusInput {
  readonly root?: string;
  readonly runId: string;
}

export interface WorkflowStopPoint {
  readonly nodeId?: string;
  readonly summary?: string;
  readonly nextSteps: readonly string[];
}

export interface WorkflowStatusResult extends WorkflowRun {
  readonly latestCheckpoint?: WorkflowCheckpoint;
  readonly currentStopPoint: WorkflowStopPoint;
  readonly openNodeCount: number;
  readonly doneNodeCount: number;
  readonly resumeCommand: WorkflowToolCommand;
}

export interface WorkflowResumePacketInput {
  readonly root?: string;
  readonly runId: string;
}

export interface WorkflowResumePacket {
  readonly kind: "agent_packet";
  readonly runId: string;
  readonly workflowId: string;
  readonly objective: string;
  readonly nodeId?: string;
  readonly planRef: string;
  readonly stateRef: string;
  readonly latestCheckpoint?: WorkflowCheckpoint;
  readonly stopCondition: string;
  readonly nextAction: {
    readonly command: WorkflowToolCommand;
  };
  readonly workerExecution: WorkflowWorkerExecution;
}

export interface WorkflowNextPacketInput {
  readonly root?: string;
  readonly runId: string;
}

export interface WorkflowNextPacket {
  readonly kind: WorkflowPacketKind;
  readonly runId: string;
  readonly packet?: WorkflowResumePacket;
  readonly reason?: string;
}

export interface WorkflowPacketInput {
  readonly objective: string;
  readonly scopePaths?: readonly string[];
  readonly evidenceRefs?: readonly string[];
  readonly allowedTools?: readonly string[];
  readonly verification?: string;
  readonly stopCondition?: string;
  readonly requiredSteps?: readonly string[];
}

export interface WorkflowPacketFitInput {
  readonly workerAgent?: WorkflowWorkerAgent;
  readonly packet: WorkflowPacketInput;
}

export interface WorkflowContextFit {
  readonly maxContextTokens: number;
  readonly maxContextSource: WorkflowContextFitSource;
  readonly maxOutputTokens: number;
  readonly usableContextTokens: number;
  readonly estimatedTokens: number;
  readonly tokenEstimateMode: WorkflowTokenEstimateMode;
}

export interface WorkflowWorkerExecution {
  readonly parallel: false;
  readonly maxConcurrentWorkers: 1;
}

export interface WorkflowPacketDiagnostic {
  readonly code: string;
  readonly severity: WorkflowPacketDiagnosticSeverity;
  readonly message: string;
}

export interface WorkflowSplitCandidate {
  readonly scopeKind: WorkflowPacketScopeKind;
  readonly scopePaths: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly reason: string;
}

export interface WorkflowPacketFitResult {
  readonly fits: boolean;
  readonly requiredAction: WorkflowPacketRequiredAction;
  readonly contextFit: WorkflowContextFit;
  readonly workerExecution: WorkflowWorkerExecution;
  readonly diagnostics: readonly WorkflowPacketDiagnostic[];
  readonly splitCandidates: readonly WorkflowSplitCandidate[];
}
