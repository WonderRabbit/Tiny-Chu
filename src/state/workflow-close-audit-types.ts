export interface WorkflowCloseInput {
  readonly root?: string;
  readonly runId: string;
  readonly summary?: string;
  readonly evidenceGate?: {
    readonly status?: string;
  };
}

export interface WorkflowCloseStoreInput {
  readonly runId: string;
  readonly summary?: string;
}

export type WorkflowCloseStatus = "closed" | "rejected";

export type WorkflowAuditStatus = "pass" | "fail";

export type WorkflowAuditFindingCode =
  | "stale_run"
  | "workflow_not_done"
  | "missing_evidence_ref"
  | "orphan_report"
  | "checkpoint_gap"
  | "final_response_missing_state_ref"
  | "projection_newer_than_json";

export type WorkflowAuditFindingSeverity = "error" | "warning";

export interface WorkflowAuditToolCall {
  readonly tool: string;
  readonly input: Readonly<Record<string, string | number | boolean | readonly string[]>>;
}

export interface WorkflowAuditFinding {
  readonly code: WorkflowAuditFindingCode;
  readonly severity: WorkflowAuditFindingSeverity;
  readonly message: string;
  readonly ref?: string;
  readonly remediationToolCalls: readonly WorkflowAuditToolCall[];
}

export interface WorkflowAuditInput {
  readonly root?: string;
  readonly runId?: string;
  readonly now?: string;
  readonly staleAfterSeconds?: number;
  readonly finalResponse?: string;
}

export interface WorkflowAuditResult {
  readonly status: WorkflowAuditStatus;
  readonly runId?: string;
  readonly findings: readonly WorkflowAuditFinding[];
  readonly sotRefs: readonly string[];
}
export interface WorkflowCloseResult {
  readonly status: WorkflowCloseStatus;
  readonly runId: string;
  readonly closedAt?: string;
  readonly findings: readonly WorkflowAuditFinding[];
  readonly sotRefs: readonly string[];
}
