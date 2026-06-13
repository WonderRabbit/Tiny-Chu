import { tool, type Hooks, type Plugin, type ToolContext, type ToolDefinition } from "@opencode-ai/plugin";
import { renderBudgetedOutput } from "./output-budget.js";
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
  { name: "public_complete", description: "Complete a public worker job after result validation." },
  { name: "context_bundle", description: "Bundle nearest AGENTS.md and project rule context for a target path." },
  { name: "context_packet", description: "Return bounded context and evidence refs for small-context resume." },
  { name: "context_digest", description: "Return bounded file evidence snippets with citations for small-context models." },
  { name: "repo_map", description: "Build a bounded architecture and UI-to-data-flow map for small-context analysis." },
  { name: "business_logic_map", description: "Extract bounded variables, columns, and comparison evidence for complex business logic analysis." },
  { name: "legacy_repo_index", description: "Build a deterministic legacy FE/BE/DB/RFC evidence index for trace analysis." },
  { name: "ui_action_trace", description: "Trace React UI events to handlers, Redux actions, sagas, and API clients when evidence exists." },
  { name: "api_backend_trace", description: "Trace FE API calls to backend route, service, mapper, and RFC evidence." },
  { name: "integration_catalog", description: "Catalog MyBatis SQL mapper and SAP JCo-style RFC evidence." },
  { name: "traceability_matrix", description: "Merge UI/API/backend/integration evidence into a Markdown-ready traceability matrix." },
  { name: "evidence_qa", description: "Audit trace artifacts for missing evidence, hallucinated symbols, and Unknown gaps." },
  { name: "evidence_snapshot", description: "Summarize existing evidence files as bounded reusable metadata." },
  { name: "doctor", description: "Return a normalized Tiny-Chu health facade across environment, state, and session checks." },
  { name: "claim_evidence_check", description: "Fail closed when artifact claims reference unsupported symbols or missing evidence." },
  { name: "session_preflight", description: "Return latest task checkpoint, verification tools, and small-context budget ledger." },
  { name: "powershell_command_guard", description: "Validate generated native-tool commands for PowerShell-safe execution." },
  { name: "trace_diagram_render", description: "Render Mermaid diagrams deterministically from traceability JSON." },
  { name: "tiny_chu_install_check", description: "Summarize Tiny-Chu OpenCode plugin readiness and exposed tools." },
  { name: "environment_doctor", description: "Check OpenCode, Ollama, PowerShell, Node, and native analysis tool readiness." },
  { name: "api_contract_catalog", description: "Catalog FE/BE API contract candidates and endpoint mismatches." },
  { name: "dto_schema_map", description: "Map UI payload, DTO, MyBatis, and RFC parameter evidence." },
  { name: "redux_state_flow_map", description: "Map Redux reducers, selectors, saga reads, and writes." },
  { name: "auth_permission_trace", description: "Trace UI/API/backend permission and role-condition evidence." },
  { name: "error_transaction_map", description: "Map error handlers, transaction boundaries, and recovery risks." },
  { name: "test_impact_planner", description: "Plan impacted and missing tests from evidence-backed change context." },
  { name: "worker_packet_optimizer", description: "Slice bounded Qwen worker packets with retry and recovery metadata." },
  { name: "artifact_pack_manifest", description: "Validate grouped design artifact readiness and missing outputs." },
  { name: "incremental_evidence_cache", description: "Detect stale repository evidence with hash-based invalidation." },
  { name: "button_workflow_plan", description: "Plan one work item per detected UI button/control." },
  { name: "button_worker_packet", description: "Build a JSON-only public worker packet for exactly one button." },
  { name: "button_workflow_dispatch", description: "Dispatch one-button worker packets sequentially by default." },
  { name: "markdown_envelope_check", description: "Reject Markdown masquerading as JSON-only worker output." },
  { name: "button_worker_result_check", description: "Validate one-button worker result evidence before completion." },
  { name: "button_trace_aggregate", description: "Aggregate validated one-button trace rows." },
  { name: "aggregation_drift_check", description: "Detect semantic drift between previous and current button trace aggregates." },
  { name: "atomic_markdown_write", description: "Write generated Markdown atomically inside the configured root." },
  { name: "write_loop_guard", description: "Guard generated Markdown writes against loops, empties, and identical churn." },
  { name: "button_workflow_done_claim", description: "Validate the final button workflow done claim." },
  { name: "wiki_bundle", description: "Bundle canonical Tiny-Chu wiki documents by reference." },
  { name: "orchestration_profile", description: "Return the small-context OpenCode orchestration profile." },
  { name: "qwen_retry_policy", description: "Return qwen3.6-35b-a3b public rate-limit retry and chunking guidance." },
  { name: "orchestration_health", description: "Summarize task and public-worker health with recovery steps that preserve progress." },
  { name: "rules_snapshot", description: "Write current Tiny-Chu architecture implementation patterns to .tiny/rules." },
  { name: "tool_usage_plan", description: "Choose a small-model-safe command and Tiny-Chu tool sequence for a task." },
  { name: "ui_layout_catalog", description: "Catalog source-code-first UX layout elements from React/JS/TS screens." },
  { name: "ux_rationale_trace", description: "Explain UI element existence and position with conservative evidence statuses." },
  { name: "ux_validation_matrix", description: "Split UX field value kinds, client rules, server rules, and message evidence." },
  { name: "layout_truth_update", description: "Persist evidence-backed UX layout truth under .tiny/ux without downgrading verified facts." },
  { name: "layout_truth_verify", description: "Verify persisted layout truth against current source fingerprints." },
  { name: "layout_truth_report", description: "Render layout truth repository memory as Markdown." },
  { name: "ux_reverse_report", description: "Render UX reverse-engineering Markdown from catalog, rationale, and validation evidence." },
  { name: "resume_packet", description: "Return the active task goal, latest checkpoint, next steps, and open questions." },
  { name: "task_focus_packet", description: "Return the current task plus plan focus and latest checkpoint." },
  { name: "chunked_write_plan", description: "Split large Markdown output into bounded write chunks before editing files." },
  { name: "artifact_format_template", description: "Return the required artifact format template before generation." },
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

function tinyTool(spec: ToolSpec, handler: TinyToolHandler): ToolDefinition {
  return tool({
    description: spec.description,
    args: {
      input: tool.schema.record(tool.schema.string(), tool.schema.unknown()).default({}).describe("Tiny-Chu tool input object."),
    },
    async execute(args, context) {
      const value = await handler(args.input, toolContext(context));
      const budgeted = renderBudgetedOutput(value, args.input);
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
      const focus = await tiny.tools.task_focus_packet({});
      compaction.context.push(`Tiny-Chu plugin active. Resume with task_focus_packet. ${JSON.stringify(focus)}`);
    },
  };
};
