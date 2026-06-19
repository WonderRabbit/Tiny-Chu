import type { PublicDispatcher, PublicJob } from "../dispatcher/public-job.js";
import { rejectRejectedPlanReviewGate } from "./plan-review-gate.js";
import type { TinyToolHandler } from "./tiny-plugin-types.js";
import { publicJobFormatInput, stringInput, stringListInput } from "./tiny-tool-inputs.js";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
}

export function createPublicDispatchHandler(root: string, publicDispatcher: () => PublicDispatcher): TinyToolHandler {
  return async (input): Promise<PublicJob> => {
    const gateInput = typeof input.planRef === "string" ? { ...record(input.planReviewGate), planRef: input.planRef } : input.planReviewGate;
    await rejectRejectedPlanReviewGate(gateInput, root);
    return publicDispatcher().dispatch({
      taskId: typeof input.taskId === "string" ? input.taskId : undefined,
      prompt: stringInput(input, "prompt"),
      rulesRefs: Array.isArray(input.rulesRefs) ? input.rulesRefs.map(String) : [],
      wikiRefs: Array.isArray(input.wikiRefs) ? input.wikiRefs.map(String) : [],
      planRef: typeof input.planRef === "string" ? input.planRef : undefined,
      checkpointSummary: typeof input.checkpointSummary === "string" ? input.checkpointSummary : undefined,
      mustReturn: stringListInput(input, "mustReturn"),
      artifactType: typeof input.artifactType === "string" ? input.artifactType : undefined,
      format: publicJobFormatInput(input.format),
    });
  };
}
