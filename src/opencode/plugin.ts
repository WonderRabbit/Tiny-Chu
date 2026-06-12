import { tool, type Hooks, type Plugin, type ToolContext, type ToolDefinition } from "@opencode-ai/plugin";
import { createTinyInfiPlugin, type TinyToolContext, type TinyToolHandler } from "./tiny-plugin.js";

type TinyChuPluginOptions = {
  readonly root?: string;
};

type ToolSpec = {
  readonly name: string;
  readonly description: string;
};

const TOOL_SPECS: readonly ToolSpec[] = [
  { name: "task_create", description: "Create a durable Tiny-Chu task under .tiny/tasks." },
  { name: "task_get", description: "Read a Tiny-Chu task by id." },
  { name: "task_list", description: "List Tiny-Chu tasks, optionally filtered by status." },
  { name: "task_update", description: "Update Tiny-Chu task metadata." },
  { name: "task_checkpoint", description: "Append a resume checkpoint with pass, artifact, evidence, and verification metadata." },
  { name: "public_dispatch", description: "Queue a public worker job packet for delegated analysis or artifact drafting." },
  { name: "public_collect", description: "Read a public worker job packet by id." },
  { name: "public_checkpoint", description: "Mark a public worker job checkpointed with partial result metadata." },
  { name: "public_retry", description: "Move a public worker job to retry_wait with backoff metadata." },
  { name: "public_cancel", description: "Cancel a public worker job packet." },
  { name: "context_bundle", description: "Bundle nearest AGENTS.md and project rule context for a target path." },
  { name: "context_digest", description: "Return bounded file evidence snippets with citations for small-context models." },
  { name: "repo_map", description: "Build a bounded architecture and UI-to-data-flow map for small-context analysis." },
  { name: "business_logic_map", description: "Extract bounded variables, columns, and comparison evidence for complex business logic analysis." },
  { name: "legacy_repo_index", description: "Build a deterministic legacy FE/BE/DB/RFC evidence index for trace analysis." },
  { name: "ui_action_trace", description: "Trace React UI events to handlers, Redux actions, sagas, and API clients when evidence exists." },
  { name: "api_backend_trace", description: "Trace FE API calls to backend route, service, mapper, and RFC evidence." },
  { name: "integration_catalog", description: "Catalog MyBatis SQL mapper and SAP JCo-style RFC evidence." },
  { name: "traceability_matrix", description: "Merge UI/API/backend/integration evidence into a Markdown-ready traceability matrix." },
  { name: "evidence_qa", description: "Audit trace artifacts for missing evidence, hallucinated symbols, and Unknown gaps." },
  { name: "wiki_bundle", description: "Bundle canonical Tiny-Chu wiki documents by reference." },
  { name: "orchestration_profile", description: "Return the small-context OpenCode orchestration profile." },
  { name: "qwen_retry_policy", description: "Return qwen3.6-35b-a3b public rate-limit retry and chunking guidance." },
  { name: "orchestration_health", description: "Summarize task and public-worker health with recovery steps that preserve progress." },
  { name: "rules_snapshot", description: "Write current Tiny-Chu architecture implementation patterns to .tiny/rules." },
  { name: "tool_usage_plan", description: "Choose a small-model-safe command and Tiny-Chu tool sequence for a task." },
  { name: "resume_packet", description: "Return the active task goal, latest checkpoint, next steps, and open questions." },
  { name: "chunked_write_plan", description: "Split large Markdown output into bounded write chunks before editing files." },
  { name: "artifact_check", description: "Validate AS-IS, UI, story, testcase, Mermaid sequence/flow, and ERD artifacts against evidence rules." },
  { name: "mermaid_check", description: "Check Mermaid fenced blocks for common formatting and syntax issues." },
  { name: "mermaid_fix", description: "Normalize Mermaid fenced blocks and close unclosed fences when deterministic." },
];

function optionRoot(options?: Record<string, unknown>): string | undefined {
  return typeof options?.root === "string" && options.root.trim() !== "" ? options.root : undefined;
}

function toolContext(context: ToolContext): TinyToolContext {
  return {
    sessionId: context.sessionID,
    targetPath: context.directory,
  };
}

function output(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function tinyTool(spec: ToolSpec, handler: TinyToolHandler): ToolDefinition {
  return tool({
    description: spec.description,
    args: {
      input: tool.schema.record(tool.schema.string(), tool.schema.unknown()).default({}).describe("Tiny-Chu tool input object."),
    },
    async execute(args, context) {
      const value = await handler(args.input, toolContext(context));
      return {
        title: `tiny-chu:${spec.name}`,
        output: output(value),
        metadata: {
          tool: spec.name,
        },
      };
    },
  });
}

export const TinyChuOpenCodePlugin: Plugin = async (input, options): Promise<Hooks> => {
  const root = optionRoot(options) ?? input.worktree ?? input.directory;
  const tiny = createTinyInfiPlugin({ root });
  const toolMap: Record<string, ToolDefinition> = {};
  for (const spec of TOOL_SPECS) {
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
    },
    "experimental.session.compacting": async (_input, compaction) => {
      compaction.context.push("Tiny-Chu plugin active. Resume from .tiny/tasks checkpoints and validate repository artifacts with artifact_check before accepting them.");
    },
  };
};
