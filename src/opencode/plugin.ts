import { tool, type Hooks, type Plugin, type ToolContext, type ToolDefinition } from "@opencode-ai/plugin";
import type { TinyComposedToolSpec } from "./feature-package.js";
import { renderBudgetedOutput } from "./output-budget.js";
import { normalizeTinyChuRuntimeMode, type TinyChuRuntimeMode } from "./runtime-mode.js";
import { createTinyChuPlugin, type TinyToolContext, type TinyToolHandler } from "./tiny-plugin.js";

type TinyChuPluginOptions = {
  readonly root?: string;
  readonly mode: TinyChuRuntimeMode;
  readonly safeTooling?: boolean;
  readonly nativePreviews?: boolean;
};

function optionRoot(options?: Record<string, unknown>): string | undefined {
  return typeof options?.root === "string" && options.root.trim() !== "" ? options.root : undefined;
}

function pluginOptions(options?: Record<string, unknown>): TinyChuPluginOptions {
  return {
    root: optionRoot(options),
    mode: normalizeTinyChuRuntimeMode(options?.mode),
    safeTooling: options?.safeTooling === true,
    nativePreviews: options?.nativePreviews === true,
  };
}

function toolContext(context: ToolContext): TinyToolContext {
  return {
    sessionId: context.sessionID,
    targetPath: context.directory,
  };
}

function tinyTool(spec: TinyComposedToolSpec, handler: TinyToolHandler): ToolDefinition {
  return tool({
    description: spec.description,
    args: {
      input: tool.schema.record(tool.schema.string(), tool.schema.unknown()).default({}).describe("Tiny-Chu tool input object."),
    },
    async execute(args, context) {
      const value = await handler(args.input, toolContext(context));
      const budgetInput = spec.name === "tiny_chu_install_check" && args.input.maxOutputChars === undefined
        ? { ...args.input, maxOutputChars: 20_000, maxArrayItems: 200 }
        : args.input;
      const budgeted = renderBudgetedOutput(value, budgetInput);
      return {
        title: `tiny-chu:${spec.name}`,
        output: budgeted.output,
        metadata: {
          tool: spec.name,
          ...budgeted.metadata,
        },
      };
    },
  });
}

export const TinyChuOpenCodePlugin: Plugin = async (input, options): Promise<Hooks> => {
  const parsedOptions = pluginOptions(options);
  const root = parsedOptions.root ?? input.worktree ?? input.directory;
  const tiny = createTinyChuPlugin({ root, mode: parsedOptions.mode, safeTooling: parsedOptions.safeTooling, nativePreviews: parsedOptions.nativePreviews });
  const toolMap: Record<string, ToolDefinition> = {};
  for (const spec of tiny.registry.toolSpecs) {
    const handler = tiny.tools[spec.name];
    if (handler) toolMap[spec.name] = tinyTool(spec, handler);
  }

  return {
    tool: toolMap,
    "chat.message": async (_input, messageOutput) => {
      const textPart = messageOutput.parts.find((part) => part.type === "text");
      if (!textPart || typeof textPart.text !== "string") return;
      textPart.text = await tiny.hooks.transformUserMessage(textPart.text, { targetPath: root });
    },
    "shell.env": async (_input, envOutput) => {
      envOutput.env.TINY_CHU_ROOT = root;
      envOutput.env.TINY_CHU_OPENCODE_PLUGIN = "1";
      envOutput.env.TINY_CHU_MODE = tiny.runtimeMode;
    },
    "experimental.session.compacting": async (_input, compaction) => {
      const focus = await tiny.tools.task_focus_packet({});
      compaction.context.push(`Tiny-Chu plugin active. Resume with task_focus_packet. ${JSON.stringify(focus)}`);
    },
  };
};
