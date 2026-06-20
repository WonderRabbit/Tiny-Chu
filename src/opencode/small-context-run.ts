import type { SmallContextModelProfile } from "./small-context-profile.js";

export type SmallContextRunStatus = "ready" | "degraded" | "attention" | "blocked";

export interface SmallContextRunModel {
  readonly provider: SmallContextModelProfile["provider"];
  readonly runtimeModel: string;
  readonly officialModel?: string;
  readonly role: string;
  readonly inputTokenTarget: number;
  readonly outputTokenTarget: number;
}

export interface SmallContextRunDirtyWorktreeDetector {
  readonly status: "clean" | "dirty" | "skipped" | "degraded";
  readonly command: "git status --porcelain=v1 -z --untracked-files=no";
  readonly trackedFiles: readonly string[];
  readonly message: string;
}

export interface SmallContextRunGate {
  readonly status: SmallContextRunStatus;
  readonly mode: "small_context";
  readonly noLiveProviderCalls: true;
  readonly localToolsOnly: true;
  readonly models: {
    readonly foreman: SmallContextRunModel;
    readonly delegate: SmallContextRunModel;
  };
  readonly requiredFirstTools: readonly string[];
  readonly correctionWorkflow: readonly {
    readonly order: number;
    readonly tinyTool: string;
    readonly purpose: string;
  }[];
  readonly staleEvidence: {
    readonly source: "incremental_evidence_cache";
    readonly semantics: "source_hash_staleness";
    readonly dirtyWorktreeDetector: boolean;
  };
  readonly dirtyWorktreePolicy: {
    readonly advisoryOnly: boolean;
    readonly commandChecklist: readonly string[];
    readonly detector?: SmallContextRunDirtyWorktreeDetector;
  };
  readonly session?: {
    readonly taskId?: string;
    readonly status: "ready" | "skipped" | "attention" | "blocked";
    readonly message: string;
  };
}

export const DEFAULT_SMALL_CONTEXT_MODELS = {
  foreman: {
    provider: "ollama",
    model: "gemma4-small",
    role: "local foreman that plans, checkpoints, and routes narrow evidence packets",
    inputTokenTarget: 1800,
    outputTokenTarget: 700,
  },
  delegate: {
    provider: "opencode-agent",
    model: "qwen3.6-35b-a3b",
    role: "large analysis/design/artifact worker for source reading and synthesis",
    inputTokenTarget: 12000,
    outputTokenTarget: 4000,
  },
} as const satisfies {
  readonly foreman: SmallContextModelProfile;
  readonly delegate: SmallContextModelProfile;
};

export function createSmallContextRunGate(input: {
  readonly status?: SmallContextRunStatus;
  readonly foreman: SmallContextModelProfile;
  readonly delegate: SmallContextModelProfile;
  readonly session?: SmallContextRunGate["session"];
  readonly dirtyWorktreePolicy?: {
    readonly advisoryOnly: boolean;
    readonly detector: SmallContextRunDirtyWorktreeDetector;
  };
}): SmallContextRunGate {
  return {
    status: input.status ?? "ready",
    mode: "small_context",
    noLiveProviderCalls: true,
    localToolsOnly: true,
    models: {
      foreman: {
        provider: input.foreman.provider,
        runtimeModel: input.foreman.model,
        role: input.foreman.role,
        inputTokenTarget: input.foreman.inputTokenTarget,
        outputTokenTarget: input.foreman.outputTokenTarget,
      },
      delegate: {
        provider: input.delegate.provider,
        runtimeModel: input.delegate.model,
        officialModel: "Qwen3.6-35B-A3B",
        role: input.delegate.role,
        inputTokenTarget: input.delegate.inputTokenTarget,
        outputTokenTarget: input.delegate.outputTokenTarget,
      },
    },
    requiredFirstTools: ["doctor", "session_preflight", "context_packet", "tool_usage_plan", "claim_evidence_check", "task_checkpoint"],
    correctionWorkflow: [
      { order: 1, tinyTool: "doctor", purpose: "confirm readiness and session status before loading context" },
      { order: 2, tinyTool: "session_preflight", purpose: "recover active task state when a task id exists" },
      { order: 3, tinyTool: "context_packet", purpose: "load bounded rules, evidence refs, and notes instead of full repository context" },
      { order: 4, tinyTool: "incremental_evidence_cache", purpose: "check source hash staleness before trusting prior evidence" },
      { order: 5, tinyTool: "tool_usage_plan", purpose: "choose the next capped command/tool sequence and verification block" },
      { order: 6, tinyTool: "worker_packet_optimizer", purpose: "shape Qwen packets locally with dispatch:false before any public queue write" },
      { order: 7, tinyTool: "qwen_retry_policy", purpose: "calculate limits and recovery without calling a provider" },
      { order: 8, tinyTool: "claim_evidence_check", purpose: "reject unsupported named claims before accepting output" },
      { order: 9, tinyTool: "artifact_pack_manifest", purpose: "verify grouped artifacts and missing outputs before completion" },
      { order: 10, tinyTool: "task_checkpoint", purpose: "persist compact continuation state before stopping or delegating" },
    ],
    staleEvidence: {
      source: "incremental_evidence_cache",
      semantics: "source_hash_staleness",
      dirtyWorktreeDetector: Boolean(input.dirtyWorktreePolicy),
    },
    dirtyWorktreePolicy: {
      advisoryOnly: input.dirtyWorktreePolicy?.advisoryOnly ?? true,
      commandChecklist: [
        "run git status --short before editing",
        "for every dirty tracked file in scope, inspect git diff -- <file>",
        "do not infer dirty worktree state from incremental_evidence_cache",
      ],
      ...(input.dirtyWorktreePolicy ? { detector: input.dirtyWorktreePolicy.detector } : {}),
    },
    ...(input.session ? { session: input.session } : {}),
  };
}

export function createDefaultSmallContextRunGate(input: {
  readonly status?: SmallContextRunStatus;
  readonly session?: SmallContextRunGate["session"];
  readonly dirtyWorktreePolicy?: {
    readonly advisoryOnly: boolean;
    readonly detector: SmallContextRunDirtyWorktreeDetector;
  };
} = {}): SmallContextRunGate {
  return createSmallContextRunGate({
    foreman: DEFAULT_SMALL_CONTEXT_MODELS.foreman,
    delegate: DEFAULT_SMALL_CONTEXT_MODELS.delegate,
    ...input,
  });
}
