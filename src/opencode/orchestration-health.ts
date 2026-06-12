import { PublicDispatcher, type PublicJobStatus } from "../dispatcher/public-job.js";
import { TaskStore, type TaskStatus } from "../state/task-store.js";
import { QWEN_PUBLIC_LIMITS } from "./qwen-retry-policy.js";

export interface StatusCount<T extends string> {
  readonly status: T;
  readonly count: number;
}

export interface OrchestrationHealthResult {
  readonly status: "healthy" | "attention";
  readonly qwen: {
    readonly model: "qwen3.6-35b-a3b";
    readonly limits: typeof QWEN_PUBLIC_LIMITS;
  };
  readonly tasks: {
    readonly total: number;
    readonly byStatus: readonly StatusCount<TaskStatus>[];
  };
  readonly publicJobs: {
    readonly total: number;
    readonly byStatus: readonly StatusCount<PublicJobStatus>[];
    readonly retryable: number;
  };
  readonly recoverySteps: readonly string[];
}

const TASK_STATUSES: readonly TaskStatus[] = ["todo", "in_progress", "blocked", "done", "cancelled"];
const JOB_STATUSES: readonly PublicJobStatus[] = ["queued", "running", "checkpointed", "retry_wait", "done", "failed", "cancelled"];

function counts<T extends string>(values: readonly T[], statuses: readonly T[]): readonly StatusCount<T>[] {
  return statuses.map((status) => ({ status, count: values.filter((value) => value === status).length })).filter((item) => item.count > 0);
}

export async function createOrchestrationHealth(root: string | undefined): Promise<OrchestrationHealthResult> {
  const tasks = await new TaskStore({ root }).list();
  const jobs = await new PublicDispatcher({ root }).list();
  const taskStatuses = tasks.map((task) => task.status);
  const jobStatuses = jobs.map((job) => job.status);
  const retryable = jobs.filter((job) => job.status === "failed" || job.status === "retry_wait" || job.status === "checkpointed").length;
  const needsAttention = taskStatuses.includes("blocked") || jobStatuses.includes("failed") || jobStatuses.includes("retry_wait") || jobStatuses.includes("checkpointed");
  return {
    status: needsAttention ? "attention" : "healthy",
    qwen: {
      model: "qwen3.6-35b-a3b",
      limits: QWEN_PUBLIC_LIMITS,
    },
    tasks: {
      total: tasks.length,
      byStatus: counts(taskStatuses, TASK_STATUSES),
    },
    publicJobs: {
      total: jobs.length,
      byStatus: counts(jobStatuses, JOB_STATUSES),
      retryable,
    },
    recoverySteps: [
      "read resume_packet for the active task before continuing",
      "write task_checkpoint before every retry so partial analysis is not lost",
      "call qwen_retry_policy to compute wait and chunking when qwen3.6-35b-a3b is rate limited",
      "use public_retry for failed, checkpointed, or retry_wait jobs instead of dropping work",
      "run artifact_check and mermaid_check before marking analysis artifacts done",
    ],
  };
}
