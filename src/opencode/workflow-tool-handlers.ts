import {
  createWorkflow,
  createWorkflowCheckpoint,
  createWorkflowNextPacket,
  createWorkflowPacketFitCheck,
  createWorkflowResumePacket,
  createWorkflowStatus,
} from "../state/workflow-helpers.js";
import { createWorkflowAudit, createWorkflowClose } from "./workflow-reliability.js";
import { resolveTinyChuPaths } from "../state/paths.js";
import { resolvePathInsideRoot } from "../state/path-safety.js";
import type { WorkflowNodeInput, WorkflowNodeStatus, WorkflowPacketInput, WorkflowWorkerAgent, WorkflowWorkerAgentConfig } from "../state/workflow-types.js";
import type { TinyToolHandler } from "./tiny-plugin-types.js";
import { numberInput, stringInput, stringListInput } from "./tiny-tool-inputs.js";

export function createWorkflowToolHandlers(root: string | undefined): Record<string, TinyToolHandler> {
  return {
    workflow_create: async (input) => createWorkflow({
      root,
      workflowId: stringInput(input, "workflowId"),
      objective: stringInput(input, "objective"),
      targetPath: optionalTargetPath(root, input),
      workerAgent: workerAgentInput(input.workerAgent),
      nodes: nodesInput(input.nodes),
    }),
    workflow_status: async (input) => createWorkflowStatus({ root, runId: stringInput(input, "runId") }),
    workflow_checkpoint: async (input) => createWorkflowCheckpoint({
      root,
      runId: stringInput(input, "runId"),
      nodeId: stringInput(input, "nodeId"),
      summary: stringInput(input, "summary"),
      status: workflowNodeStatusInput(input.status),
      nextSteps: stringListInput(input, "nextSteps"),
      evidenceRefs: stringListInput(input, "evidenceRefs"),
    }),
    workflow_resume_packet: async (input) => createWorkflowResumePacket({ root, runId: stringInput(input, "runId") }),
    workflow_packet_fit_check: async (input) => createWorkflowPacketFitCheck({
      workerAgent: workerAgentInput(input.workerAgent),
      packet: packetInput(input.packet),
    }),
    workflow_next: async (input) => createWorkflowNextPacket({ root, runId: stringInput(input, "runId") }),
    workflow_close: async (input) => createWorkflowClose(root, {
      root,
      runId: stringInput(input, "runId"),
      summary: optionalString(input, "summary"),
      evidenceGate: evidenceGateInput(input.evidenceGate),
    }),
    workflow_audit: async (input) => createWorkflowAudit(root, {
      root,
      runId: optionalString(input, "runId"),
      now: optionalString(input, "now"),
      staleAfterSeconds: numberInput(input, "staleAfterSeconds"),
      finalResponse: optionalString(input, "finalResponse"),
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  return typeof input[key] === "string" && input[key].trim() !== "" ? input[key] : undefined;
}

function optionalTargetPath(root: string | undefined, input: Record<string, unknown>): string | undefined {
  const targetPath = optionalString(input, "targetPath");
  if (!targetPath) return undefined;
  const configuredRoot = resolveTinyChuPaths(root).root;
  if (!resolvePathInsideRoot(configuredRoot, targetPath)) throw new Error(`Target path is outside configured root: ${targetPath}`);
  return targetPath;
}

function workerAgentInput(value: unknown): WorkflowWorkerAgent | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("Invalid workerAgent input");
  return {
    id: optionalString(value, "id"),
    config: workerAgentConfigInput(value.config),
  };
}

function evidenceGateInput(value: unknown): { readonly status?: string } | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("Invalid evidenceGate input");
  return { status: optionalString(value, "status") };
}

function workerAgentConfigInput(value: unknown): WorkflowWorkerAgentConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("Invalid workerAgent.config input");
  return {
    maxContextTokens: numberInput(value, "maxContextTokens"),
    maxOutputTokens: numberInput(value, "maxOutputTokens"),
    maxDurationSeconds: numberInput(value, "maxDurationSeconds"),
  };
}

function nodesInput(value: unknown): readonly WorkflowNodeInput[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("Invalid workflow nodes input");
  return value.map(nodeInput);
}

function nodeInput(value: unknown): WorkflowNodeInput {
  if (!isRecord(value)) throw new Error("Invalid workflow node input");
  return {
    nodeId: stringInput(value, "nodeId"),
    type: optionalString(value, "type"),
    title: optionalString(value, "title"),
    dependencies: stringListInput(value, "dependencies"),
  };
}

function workflowNodeStatusInput(value: unknown): WorkflowNodeStatus | undefined {
  switch (value) {
    case "blocked":
    case "ready":
    case "running":
    case "checkpointed":
    case "done":
    case "failed":
    case "cancelled":
      return value;
    default:
      return undefined;
  }
}

function packetInput(value: unknown): WorkflowPacketInput {
  if (!isRecord(value)) throw new Error("Missing workflow packet input");
  return {
    objective: stringInput(value, "objective"),
    scopePaths: stringListInput(value, "scopePaths"),
    evidenceRefs: stringListInput(value, "evidenceRefs"),
    allowedTools: stringListInput(value, "allowedTools"),
    verification: optionalString(value, "verification"),
    stopCondition: optionalString(value, "stopCondition"),
    requiredSteps: stringListInput(value, "requiredSteps"),
  };
}
