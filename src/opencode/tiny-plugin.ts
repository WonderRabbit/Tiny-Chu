import { loadContextBundle } from "../context/context-loader.js";
import { PublicDispatcher } from "../dispatcher/public-job.js";
import { TaskStore } from "../state/task-store.js";
import { WikiBundler } from "../wiki/wiki-bundler.js";
import { readPlanStatus } from "../ulw-loop/plan.js";

export interface OpenCodeShellRuntime {
  name: "powershell";
  executable: "pwsh";
  version: "7.6.2";
  args: readonly ["-NoLogo", "-NoProfile"];
}

export interface OpenCodeRuntimeConfig {
  shell: OpenCodeShellRuntime;
}

export const POWERSHELL_OPENCODE_RUNTIME: OpenCodeRuntimeConfig = {
  shell: {
    name: "powershell",
    executable: "pwsh",
    version: "7.6.2",
    args: ["-NoLogo", "-NoProfile"],
  },
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

export function createTinyInfiPlugin(config: TinyInfiConfig = {}): TinyPluginModule {
  const root = config.root;
  const tasks = new TaskStore({ root });
  const dispatcher = new PublicDispatcher({ root, ...config.publicDispatcher });
  const wiki = new WikiBundler(root);

  return {
    name: "tiny-infi",
    opencode: POWERSHELL_OPENCODE_RUNTIME,
    tools: {
      task_create: async (input) => tasks.create({
        title: stringInput(input, "title"),
        priority: input.priority === "low" || input.priority === "high" ? input.priority : "normal",
        notes: Array.isArray(input.notes) ? input.notes.map(String) : [],
        planRef: typeof input.planRef === "string" ? input.planRef : undefined,
      }),
      task_get: async (input) => tasks.get(stringInput(input, "id")),
      task_list: async (input) => tasks.list(typeof input.status === "string" ? input.status as never : undefined),
      task_update: async (input) => {
        const id = stringInput(input, "id");
        const { id: _ignored, ...patch } = input;
        return tasks.update(id, patch as never);
      },
      public_dispatch: async (input) => dispatcher.dispatch({
        taskId: typeof input.taskId === "string" ? input.taskId : undefined,
        prompt: stringInput(input, "prompt"),
        rulesRefs: Array.isArray(input.rulesRefs) ? input.rulesRefs.map(String) : [],
        wikiRefs: Array.isArray(input.wikiRefs) ? input.wikiRefs.map(String) : [],
        planRef: typeof input.planRef === "string" ? input.planRef : undefined,
        checkpointSummary: typeof input.checkpointSummary === "string" ? input.checkpointSummary : undefined,
      }),
      public_collect: async (input) => dispatcher.get(stringInput(input, "id")),
      public_retry: async (input) => dispatcher.retry(stringInput(input, "id"), typeof input.reason === "string" ? input.reason : undefined),
      public_cancel: async (input) => dispatcher.cancel(stringInput(input, "id"), typeof input.reason === "string" ? input.reason : undefined),
      context_bundle: async (input, context) => loadContextBundle(root, typeof input.targetPath === "string" ? input.targetPath : context?.targetPath ?? "."),
      wiki_bundle: async (input) => wiki.bundle(Array.isArray(input.refs) ? input.refs.map(String) : []),
    },
    hooks: {
      async transformUserMessage(message, context) {
        if (!/\b(ulw|ultrawork)\b/i.test(message)) return message;
        const bundle = await loadContextBundle(root, context?.targetPath ?? ".");
        return `${message}\n\n<tiny-infi-context>\n${bundle.text}\n</tiny-infi-context>`;
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
