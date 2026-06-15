import type { PublicJobStatus } from "../dispatcher/public-job.js";
import type { TaskStatus, TinyTask } from "../state/task-store.js";
import type { StatusCount } from "./orchestration-health.js";
import type { ProviderNetworkMode } from "./provider-endpoint-preflight.js";
import type { TinyChuRuntimeMode, TinyChuRuntimeModeInput } from "./runtime-mode.js";
import type { WorkflowReliabilityStatus } from "./workflow-reliability.js";

export interface DashboardSnapshotInput {
  readonly mode?: TinyChuRuntimeModeInput;
  readonly taskId?: string;
  readonly runId?: string;
  readonly includeProviderPreflight?: boolean;
  readonly provider?: string;
  readonly endpoint?: string;
  readonly networkMode?: ProviderNetworkMode;
  readonly maxTasks?: number;
  readonly maxJobs?: number;
  readonly maxEvidenceRefs?: number;
  readonly now?: string;
}

export interface DashboardSnapshotTask {
  readonly found: boolean;
  readonly id?: string;
  readonly title?: string;
  readonly status?: TaskStatus;
  readonly priority?: TinyTask["priority"];
  readonly latestCheckpointSummary?: string;
  readonly nextSteps: readonly string[];
  readonly openQuestions: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface DashboardSnapshotWorkflow {
  readonly found: boolean;
  readonly runId?: string;
  readonly status?: WorkflowReliabilityStatus;
  readonly statusLine?: string;
  readonly shouldContinue?: boolean;
  readonly warning?: string;
}

export interface DashboardSnapshotPublicJobs {
  readonly total: number;
  readonly retryable: number;
  readonly byStatus: readonly StatusCount<PublicJobStatus>[];
  readonly nextRetryAt?: string;
}

export interface DashboardSnapshotProvider {
  readonly model: "qwen3.6-35b-a3b";
  readonly health: "unknown" | "ok" | "warning" | "blocked" | "down";
  readonly preflightAttempted: boolean;
  readonly diagnostics: readonly string[];
}

export interface DashboardSnapshotContextBudget {
  readonly status: "unknown" | "fit" | "split_required" | "within_budget" | "degraded";
  readonly estimatedInputTokens?: number;
  readonly usableInputTokens?: number;
}

export interface DashboardSnapshotEvidence {
  readonly status: "unknown" | "ok" | "warning";
  readonly warnings: readonly string[];
  readonly verificationCommands: readonly string[];
}

export interface DashboardSnapshotInterrupt {
  readonly key: string;
  readonly severity: "info" | "warning" | "danger" | "success";
  readonly title: string;
  readonly message: string;
}

export interface DashboardSnapshotResult {
  readonly generatedAt: string;
  readonly runtimeMode: TinyChuRuntimeMode;
  readonly status: "healthy" | "attention" | "degraded";
  readonly task: DashboardSnapshotTask;
  readonly workflow: DashboardSnapshotWorkflow;
  readonly publicJobs: DashboardSnapshotPublicJobs;
  readonly provider: DashboardSnapshotProvider;
  readonly contextBudget: DashboardSnapshotContextBudget;
  readonly evidence: DashboardSnapshotEvidence;
  readonly warnings: readonly string[];
  readonly interrupts: readonly DashboardSnapshotInterrupt[];
}
