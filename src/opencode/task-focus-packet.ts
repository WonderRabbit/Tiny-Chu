import { readPlanStatus, selectPlanFocus, type PlanFocus } from "../ulw-loop/plan.js";
import { TaskStore, type TaskCheckpoint, type TinyTask } from "../state/task-store.js";

export interface TaskFocusPacket {
  readonly found: boolean;
  readonly reason?: string;
  readonly task?: {
    readonly id: string;
    readonly title: string;
    readonly status: TinyTask["status"];
    readonly priority: TinyTask["priority"];
  };
  readonly planFocus?: PlanFocus;
  readonly latestCheckpoint?: TaskCheckpoint;
  readonly nextSteps?: readonly string[];
  readonly evidenceRefs?: readonly string[];
  readonly openQuestions?: readonly string[];
  readonly verificationCommands?: readonly string[];
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

export async function createTaskFocusPacket(root: string | undefined, tasks: TaskStore, input: Record<string, unknown>): Promise<TaskFocusPacket> {
  const maxOpenItems = positiveInteger(input.maxOpenItems, 3);
  let task: TinyTask | undefined;
  if (typeof input.id === "string") {
    task = await tasks.get(input.id);
  } else {
    const active = (await tasks.list()).filter((item) => item.status !== "done" && item.status !== "cancelled");
    task = active.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))[0];
  }
  if (!task) return { found: false, reason: "no active task" };
  const planRef = typeof input.planRef === "string" ? input.planRef : task.planRef;
  const planFocus = planRef ? selectPlanFocus(await readPlanStatus(root, planRef), { maxOpenItems }) : undefined;
  const latestCheckpoint = task.checkpoints.at(-1);
  return {
    found: true,
    task: { id: task.id, title: task.title, status: task.status, priority: task.priority },
    ...(planFocus ? { planFocus } : {}),
    ...(latestCheckpoint ? { latestCheckpoint } : {}),
    nextSteps: latestCheckpoint?.nextSteps ?? [],
    evidenceRefs: task.evidenceRefs.slice(0, positiveInteger(input.maxEvidenceRefs, 12)),
    openQuestions: latestCheckpoint?.openQuestions ?? [],
    verificationCommands: latestCheckpoint?.verificationCommands ?? [],
  };
}
