import { readFile } from "node:fs/promises";
import { loadContextBundle } from "../context/context-loader.js";
import { PublicDispatcher } from "../dispatcher/public-job.js";
import { checkMermaidMarkdown, fixMermaidMarkdown } from "../markdown/mermaid.js";
import { resolveTinyInfiPaths } from "../state/paths.js";
import { resolveExistingPathInsideRoot } from "../state/path-safety.js";
import { TaskStore, type TaskStatus, type TinyTask } from "../state/task-store.js";
import { WikiBundler } from "../wiki/wiki-bundler.js";
import { readPlanStatus } from "../ulw-loop/plan.js";
import { checkArtifactMarkdown } from "./artifact-contract.js";
import { createApiBackendTrace } from "./api-backend-trace.js";
import { createBusinessLogicMap } from "./business-logic-map.js";
import { createEvidenceQa } from "./evidence-qa.js";
import { createIntegrationCatalog } from "./integration-catalog.js";
import { createLegacyRepoIndex } from "./legacy-repo-index.js";
import { createOrchestrationHealth } from "./orchestration-health.js";
import { POWERSHELL_TOOLING_PROFILE, renderPowerShellToolingGuide, type PowerShellToolingProfile } from "./powershell-tooling.js";
import { createQwenRetryPolicy } from "./qwen-retry-policy.js";
import { createRepoMap } from "./repo-map.js";
import { writeRulesSnapshot } from "./rules-snapshot.js";
import { createSmallContextOrchestrationProfile, renderSmallContextGuide } from "./small-context-profile.js";
import { createChunkedWritePlan, createContextDigest, createResumePacket } from "./small-model-tools.js";
import { createToolUsagePlan } from "./tool-plan.js";
import { createTraceabilityMatrix } from "./traceability-matrix.js";
import { createUiActionTrace } from "./ui-action-trace.js";

export interface OpenCodeShellRuntime {
  name: "powershell";
  executable: "pwsh";
  version: "7.6.2";
  args: readonly ["-NoLogo", "-NoProfile"];
}

export interface OpenCodeRuntimeConfig {
  shell: OpenCodeShellRuntime;
  tooling: PowerShellToolingProfile;
}

export const POWERSHELL_OPENCODE_RUNTIME: OpenCodeRuntimeConfig = {
  shell: {
    name: "powershell",
    executable: "pwsh",
    version: "7.6.2",
    args: ["-NoLogo", "-NoProfile"],
  },
  tooling: POWERSHELL_TOOLING_PROFILE,
};

export interface TinyInfiConfig {
  root?: string;
  publicDispatcher?: {
    softRpm?: number;
    softTpm?: number;
    hardRpm?: number;
    hardTpm?: number;
    owner?: string;
  };
}

export interface TinyToolContext {
  sessionId?: string;
  targetPath?: string;
}

export type TinyToolHandler = (input: Record<string, unknown>, context?: TinyToolContext) => Promise<unknown>;

export interface TinyPluginModule {
  name: "tiny-infi";
  opencode: OpenCodeRuntimeConfig;
  tools: Record<string, TinyToolHandler>;
  hooks: {
    transformUserMessage(message: string, context?: TinyToolContext): Promise<string>;
    onSessionIdle(input: { planRef?: string }): Promise<{ shouldContinue: boolean; reason: string }>;
  };
}

function stringInput(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Missing string input: ${key}`);
  return value;
}

function stringListInput(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  return Array.isArray(value) ? value.map(String).filter((item) => item.trim() !== "") : [];
}

function numberInput(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function taskStatusInput(value: unknown): TaskStatus | undefined {
  switch (value) {
    case "todo":
    case "in_progress":
    case "blocked":
    case "done":
    case "cancelled":
      return value;
    default:
      return undefined;
  }
}

function taskPriorityInput(value: unknown): TinyTask["priority"] | undefined {
  switch (value) {
    case "low":
    case "normal":
    case "high":
      return value;
    default:
      return undefined;
  }
}

function taskPatchInput(input: Record<string, unknown>): Partial<Omit<TinyTask, "id" | "createdAt">> {
  const patch: Partial<Omit<TinyTask, "id" | "createdAt">> = {};
  const status = taskStatusInput(input.status);
  const priority = taskPriorityInput(input.priority);
  if (typeof input.title === "string") patch.title = input.title;
  if (status) patch.status = status;
  if (priority) patch.priority = priority;
  if (Array.isArray(input.notes)) patch.notes = input.notes.map(String);
  if (typeof input.planRef === "string") patch.planRef = input.planRef;
  if (Array.isArray(input.evidenceRefs)) patch.evidenceRefs = input.evidenceRefs.map(String);
  if (Array.isArray(input.publicJobIds)) patch.publicJobIds = input.publicJobIds.map(String);
  return patch;
}

async function markdownInput(root: string | undefined, input: Record<string, unknown>): Promise<string> {
  if (typeof input.markdown === "string") return input.markdown;
  if (typeof input.path === "string" && input.path.trim() !== "") {
    const configuredRoot = resolveTinyInfiPaths(root).root;
    const absolute = await resolveExistingPathInsideRoot(configuredRoot, input.path);
    if (!absolute) {
      throw new Error(`Mermaid path is outside configured root: ${input.path}`);
    }
    return readFile(absolute, "utf8");
  }
  throw new Error("Missing markdown or path input");
}

export function createTinyInfiPlugin(config: TinyInfiConfig = {}): TinyPluginModule {
  const root = config.root;
  const tasks = new TaskStore({ root });
  const dispatcher = new PublicDispatcher({ root, ...config.publicDispatcher });
  const wiki = new WikiBundler(root);
  const orchestrationProfile = createSmallContextOrchestrationProfile(POWERSHELL_OPENCODE_RUNTIME);

  return {
    name: "tiny-infi",
    opencode: POWERSHELL_OPENCODE_RUNTIME,
    tools: {
      task_create: async (input) => tasks.create({
        title: stringInput(input, "title"),
        priority: taskPriorityInput(input.priority) ?? "normal",
        notes: Array.isArray(input.notes) ? input.notes.map(String) : [],
        planRef: typeof input.planRef === "string" ? input.planRef : undefined,
      }),
      task_get: async (input) => tasks.get(stringInput(input, "id")),
      task_list: async (input) => tasks.list(taskStatusInput(input.status)),
      task_checkpoint: async (input) => tasks.checkpoint(stringInput(input, "id"), {
        summary: stringInput(input, "summary"),
        artifactType: typeof input.artifactType === "string" ? input.artifactType : undefined,
        passIndex: numberInput(input, "passIndex"),
        nextSteps: stringListInput(input, "nextSteps"),
        evidenceRefs: stringListInput(input, "evidenceRefs"),
        openQuestions: stringListInput(input, "openQuestions"),
        verificationCommands: stringListInput(input, "verificationCommands"),
      }),
      task_update: async (input) => {
        const id = stringInput(input, "id");
        return tasks.update(id, taskPatchInput(input));
      },
      public_dispatch: async (input) => dispatcher.dispatch({
        taskId: typeof input.taskId === "string" ? input.taskId : undefined,
        prompt: stringInput(input, "prompt"),
        rulesRefs: Array.isArray(input.rulesRefs) ? input.rulesRefs.map(String) : [],
        wikiRefs: Array.isArray(input.wikiRefs) ? input.wikiRefs.map(String) : [],
        planRef: typeof input.planRef === "string" ? input.planRef : undefined,
        checkpointSummary: typeof input.checkpointSummary === "string" ? input.checkpointSummary : undefined,
        mustReturn: stringListInput(input, "mustReturn"),
        artifactType: typeof input.artifactType === "string" ? input.artifactType : undefined,
      }),
      public_collect: async (input) => dispatcher.get(stringInput(input, "id")),
      public_checkpoint: async (input) => dispatcher.checkpoint(stringInput(input, "id"), stringInput(input, "summary"), typeof input.result === "string" ? input.result : undefined),
      public_retry: async (input) => dispatcher.retry(stringInput(input, "id"), typeof input.reason === "string" ? input.reason : undefined),
      public_cancel: async (input) => dispatcher.cancel(stringInput(input, "id"), typeof input.reason === "string" ? input.reason : undefined),
      context_bundle: async (input, context) => loadContextBundle(root, typeof input.targetPath === "string" ? input.targetPath : context?.targetPath ?? "."),
      context_digest: async (input) => createContextDigest(resolveTinyInfiPaths(root).root, input),
      repo_map: async (input) => createRepoMap(resolveTinyInfiPaths(root).root, input),
      business_logic_map: async (input) => createBusinessLogicMap(resolveTinyInfiPaths(root).root, input),
      legacy_repo_index: async (input) => createLegacyRepoIndex(resolveTinyInfiPaths(root).root, input),
      ui_action_trace: async (input) => createUiActionTrace(resolveTinyInfiPaths(root).root, input),
      api_backend_trace: async (input) => createApiBackendTrace(resolveTinyInfiPaths(root).root, input),
      integration_catalog: async (input) => createIntegrationCatalog(resolveTinyInfiPaths(root).root, input),
      traceability_matrix: async (input) => createTraceabilityMatrix(input),
      evidence_qa: async (input) => createEvidenceQa(input),
      wiki_bundle: async (input) => wiki.bundle(Array.isArray(input.refs) ? input.refs.map(String) : []),
      orchestration_profile: async () => orchestrationProfile,
      qwen_retry_policy: async (input) => createQwenRetryPolicy(input),
      orchestration_health: async () => createOrchestrationHealth(root),
      rules_snapshot: async (input) => writeRulesSnapshot(root, input),
      tool_usage_plan: async (input) => createToolUsagePlan(input),
      resume_packet: async (input) => {
        const task = await tasks.get(stringInput(input, "id"));
        if (!task) throw new Error(`Task not found: ${stringInput(input, "id")}`);
        return createResumePacket(task);
      },
      chunked_write_plan: async (input) => createChunkedWritePlan(input),
      artifact_check: async (input) => checkArtifactMarkdown({
        artifactType: stringInput(input, "artifactType"),
        markdown: await markdownInput(root, input),
        evidenceRefs: stringListInput(input, "evidenceRefs"),
      }),
      mermaid_check: async (input) => checkMermaidMarkdown(await markdownInput(root, input)),
      mermaid_fix: async (input) => fixMermaidMarkdown(await markdownInput(root, input)),
    },
    hooks: {
      async transformUserMessage(message, context) {
        if (!/\b(ulw|ultrawork)\b/i.test(message)) return message;
        const bundle = await loadContextBundle(root, context?.targetPath ?? ".");
        return `${message}\n\n<tiny-infi-context>\n${bundle.text}\n</tiny-infi-context>\n\n<tiny-infi-powershell-tooling>\n${renderPowerShellToolingGuide()}\n</tiny-infi-powershell-tooling>\n\n<tiny-infi-small-context>\n${renderSmallContextGuide(orchestrationProfile)}\n</tiny-infi-small-context>`;
      },
      async onSessionIdle(input) {
        if (!input.planRef) return { shouldContinue: false, reason: "no active plan" };
        const status = await readPlanStatus(root, input.planRef);
        if (status.complete) return { shouldContinue: false, reason: "plan complete" };
        return { shouldContinue: true, reason: `${status.open} open checkbox item(s) remain` };
      },
    },
  };
}
