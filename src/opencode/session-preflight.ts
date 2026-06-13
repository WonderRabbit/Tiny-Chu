import type { TaskCheckpoint, TinyTask } from "../state/task-store.js";

export interface SessionPreflightResult {
  readonly taskId: string;
  readonly latestCheckpoint?: TaskCheckpoint;
  readonly nextSteps: readonly string[];
  readonly openQuestions: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly requiredVerificationTools: readonly string[];
  readonly requiredPreparationTools: readonly string[];
  readonly budgetLedger: {
    readonly maxFiles: number;
    readonly maxSnippets: number;
    readonly maxChunks: number;
    readonly status: "within_budget" | "degraded";
  };
  readonly warnings: readonly string[];
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function verificationTools(checkpoint: TaskCheckpoint | undefined): readonly string[] {
  const base = new Set(["artifact_check", "evidence_qa", "task_checkpoint"]);
  if (checkpoint?.artifactType === "flowchart" || checkpoint?.artifactType === "sequence_diagram" || checkpoint?.artifactType === "erd") {
    base.add("mermaid_check");
  }
  for (const command of checkpoint?.verificationCommands ?? []) {
    if (command.includes("artifact_check")) base.add("artifact_check");
    if (command.includes("mermaid_check")) base.add("mermaid_check");
  }
  return [...base].sort();
}

function preparationTools(checkpoint: TaskCheckpoint | undefined): readonly string[] {
  if (!checkpoint) return [];
  const needsArtifact = checkpoint.artifactType !== undefined || checkpoint.nextSteps.some((step) => /\bartifact|flowchart|sequence|erd|markdown\b/i.test(step));
  return needsArtifact ? ["artifact_format_template"] : [];
}

export function createSessionPreflight(task: TinyTask, input: Record<string, unknown>): SessionPreflightResult {
  const latestCheckpoint = task.checkpoints.at(-1);
  const maxFiles = positiveInteger(input.maxFiles, 3);
  const maxSnippets = positiveInteger(input.maxSnippets, 12);
  const maxChunks = positiveInteger(input.maxChunks, 4);
  const degraded = maxFiles < 1 || maxSnippets < 1 || maxChunks < 1;
  return {
    taskId: task.id,
    ...(latestCheckpoint ? { latestCheckpoint } : {}),
    nextSteps: latestCheckpoint?.nextSteps ?? [],
    openQuestions: latestCheckpoint?.openQuestions ?? ["No checkpoint yet; create one before long work."],
    evidenceRefs: [...new Set([...task.evidenceRefs, ...(latestCheckpoint?.evidenceRefs ?? [])])].sort(),
    requiredVerificationTools: verificationTools(latestCheckpoint),
    requiredPreparationTools: preparationTools(latestCheckpoint),
    budgetLedger: { maxFiles, maxSnippets, maxChunks, status: degraded ? "degraded" : "within_budget" },
    warnings: latestCheckpoint ? [] : ["missing_resume_checkpoint"],
  };
}
