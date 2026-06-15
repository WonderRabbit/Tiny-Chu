import { isWorkerRuntimeMode, type TinyChuRuntimeMode } from "./runtime-mode.js";
import type { DeterministicToolCap } from "./tool-plan-caps.js";
import type { ToolPlanStep, ToolUsagePlanResult } from "./tool-plan.js";

const WORKER_HIDDEN_TOOLS = new Set([
  "analysis_workflow_start",
  "button_workflow_dispatch",
  "public_cancel",
  "public_checkpoint",
  "public_collect",
  "public_complete",
  "public_dispatch",
  "public_job_resume_packet",
  "public_retry",
  "workflow_checkpoint",
  "workflow_create",
  "workflow_next",
  "workflow_packet_fit_check",
  "workflow_progress_heartbeat",
  "workflow_resume_packet",
  "workflow_sot_audit",
  "workflow_status",
]);
const WORKER_HIDDEN_TOOL_PATTERN = /\b(analysis_workflow_start|button_workflow_dispatch|public_cancel|public_checkpoint|public_collect|public_complete|public_dispatch|public_job_resume_packet|public_retry|workflow_checkpoint|workflow_create|workflow_next|workflow_packet_fit_check|workflow_progress_heartbeat|workflow_resume_packet|workflow_sot_audit|workflow_status)\b/;

function isHiddenTool(name: string | undefined): boolean {
  return typeof name === "string" && WORKER_HIDDEN_TOOLS.has(name);
}

function workerGuidance(value: string): string | undefined {
  const safe = value
    .replace(/\bbefore public_dispatch\b/g, "with dispatch:false")
    .replace(/\bpublic_dispatch\b/g, "worker_packet_optimizer with dispatch:false")
    .replace(/\bpublic_retry\b/g, "task_checkpoint")
    .replace(/\bpublic delegation\b/gi, "local packet planning")
    .replace(/\bpublic Qwen queue path\b/gi, "Qwen packet path")
    .replace(/\bpublic Qwen failures\b/gi, "Qwen retry failures")
    .replace(/\bpublic queue\b/gi, "queue")
    .replace(/\bpublic limit\b/gi, "retry limit")
    .replace(/\bpublic worker\b/gi, "worker");
  return /\bpublic\b/i.test(safe) || WORKER_HIDDEN_TOOL_PATTERN.test(safe) ? undefined : safe;
}

function modeSafeString(value: string, runtimeMode: TinyChuRuntimeMode): string | undefined {
  return isWorkerRuntimeMode(runtimeMode) ? workerGuidance(value) : value;
}

function modeSafeStep(step: ToolPlanStep, runtimeMode: TinyChuRuntimeMode): ToolPlanStep | undefined {
  if (isWorkerRuntimeMode(runtimeMode) && isHiddenTool(step.tinyTool)) return undefined;
  const goal = modeSafeString(step.goal, runtimeMode);
  const outputBudget = modeSafeString(step.outputBudget, runtimeMode);
  if (!goal || !outputBudget) return undefined;
  return { ...step, goal, outputBudget };
}

function modeSafeCap(cap: DeterministicToolCap, runtimeMode: TinyChuRuntimeMode): DeterministicToolCap | undefined {
  const purpose = modeSafeString(cap.purpose, runtimeMode);
  return purpose ? { ...cap, purpose } : undefined;
}

function reindexSteps(steps: readonly ToolPlanStep[]): readonly ToolPlanStep[] {
  return steps.map((step, index) => ({ ...step, order: index + 1 }));
}

export function applyToolPlanRuntimeMode(result: ToolUsagePlanResult, runtimeMode: TinyChuRuntimeMode): ToolUsagePlanResult {
  if (!isWorkerRuntimeMode(runtimeMode)) return result;
  const steps = reindexSteps(result.steps.flatMap((step) => modeSafeStep(step, runtimeMode) ?? []));
  const requiredTools = result.verification.requiredTools.filter((name) => !isHiddenTool(name));
  const stopRules = result.stopRules.flatMap((rule) => modeSafeString(rule, runtimeMode) ?? []);
  const deterministicCaps = result.deterministicCaps.flatMap((cap) => modeSafeCap(cap, runtimeMode) ?? []);
  return {
    ...result,
    steps,
    nextRequiredTool: requiredTools[0],
    deterministicCaps,
    verification: { ...result.verification, requiredTools },
    stopRules,
  };
}
