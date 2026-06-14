import { markdown, readJson, writeMarkdown, writeSource, writeState, type ToolSeed } from "./tool-seed.js";

const STRING_SCHEMA = { type: "string" } as const;
const STRING_ARRAY_SCHEMA = { type: "array", items: STRING_SCHEMA } as const;
const OBJECT_SCHEMA = { type: "object" } as const;

export const CORE_RUNTIME_TOOLS: readonly ToolSeed[] = [
  writeState("task_create", "Create a durable Tiny-Chu task under .tiny/tasks."),
  readJson("task_get", "Read a Tiny-Chu task by id."),
  readJson("task_list", "List Tiny-Chu tasks, optionally filtered by status."),
  writeState("task_update", "Update Tiny-Chu task metadata."),
  writeState("task_checkpoint", "Append a resume checkpoint with pass, artifact, evidence, and verification metadata."),
  writeState("public_dispatch", "Queue a public worker job packet for delegated analysis or artifact drafting."),
  readJson("public_collect", "Read a public worker job packet by id."),
  writeState("public_checkpoint", "Mark a public worker job checkpointed with partial result metadata."),
  writeState("public_retry", "Move a public worker job to retry_wait with backoff metadata."),
  writeState("public_cancel", "Cancel a public worker job packet."),
  writeState("public_complete", "Complete a public worker job after result validation."),
  readJson("context_bundle", "Bundle nearest AGENTS.md and project rule context for a target path."),
  readJson("context_packet", "Return bounded context and evidence refs for small-context resume."),
  readJson("wiki_bundle", "Bundle canonical Tiny-Chu wiki documents by reference."),
];

export const LEGACY_ANALYSIS_TOOLS: readonly ToolSeed[] = [
  readJson("repo_map", "Build a bounded architecture and UI-to-data-flow map for small-context analysis.", ["fd", "rg"]),
  readJson("business_logic_map", "Extract bounded variables, columns, and comparison evidence for complex business logic analysis.", ["rg", "ast-grep"]),
  readJson("legacy_repo_index", "Build a deterministic legacy FE/BE/DB/RFC evidence index for trace analysis.", ["fd", "rg", "ast-grep", "jq", "yq"]),
  readJson("ui_action_trace", "Trace React UI events to handlers, Redux actions, sagas, and API clients when evidence exists.", ["rg", "ast-grep"]),
  readJson("api_backend_trace", "Trace FE API calls to backend route, service, mapper, and RFC evidence.", ["rg", "ast-grep"]),
  readJson("integration_catalog", "Catalog MyBatis SQL mapper and SAP JCo-style RFC evidence.", ["fd", "rg", "yq"]),
  readJson("traceability_matrix", "Merge UI/API/backend/integration evidence into a Markdown-ready traceability matrix."),
  readJson("evidence_qa", "Audit trace artifacts for missing evidence, hallucinated symbols, and Unknown gaps."),
];

export const EXTENSION_UTILITY_TOOLS: readonly ToolSeed[] = [
  readJson("evidence_snapshot", "Summarize existing evidence files as bounded reusable metadata."),
  readJson("claim_evidence_check", "Fail closed when artifact claims reference unsupported symbols or missing evidence."),
  readJson("api_contract_catalog", "Catalog FE/BE API contract candidates and endpoint mismatches.", ["rg", "ast-grep"]),
  readJson("dto_schema_map", "Map UI payload, DTO, MyBatis, and RFC parameter evidence.", ["rg", "ast-grep"]),
  readJson("redux_state_flow_map", "Map Redux reducers, selectors, saga reads, and writes.", ["rg", "ast-grep"]),
  readJson("auth_permission_trace", "Trace UI/API/backend permission and role-condition evidence.", ["rg", "ast-grep"]),
  readJson("error_transaction_map", "Map error handlers, transaction boundaries, and recovery risks.", ["rg", "ast-grep"]),
  readJson("test_impact_planner", "Plan impacted and missing tests from evidence-backed change context.", ["rg"]),
  writeState("worker_packet_optimizer", "Slice bounded Qwen worker packets with retry and recovery metadata."),
  readJson("artifact_pack_manifest", "Validate grouped design artifact readiness and missing outputs."),
  writeState("incremental_evidence_cache", "Detect stale repository evidence with hash-based invalidation."),
];

export const BUTTON_WORKFLOW_TOOLS: readonly ToolSeed[] = [
  readJson("button_workflow_plan", "Plan one work item per detected UI button/control.", ["rg", "ast-grep"]),
  readJson("button_worker_packet", "Build a JSON-only public worker packet for exactly one button."),
  writeState("button_workflow_dispatch", "Dispatch one-button worker packets sequentially by default."),
  readJson("markdown_envelope_check", "Reject Markdown masquerading as JSON-only worker output."),
  readJson("button_worker_result_check", "Validate one-button worker result evidence before completion."),
  readJson("button_trace_aggregate", "Aggregate validated one-button trace rows."),
  readJson("aggregation_drift_check", "Detect semantic drift between previous and current button trace aggregates."),
  writeMarkdown("atomic_markdown_write", "Write generated Markdown atomically inside the configured root."),
  readJson("write_loop_guard", "Guard generated Markdown writes against loops, empties, and identical churn."),
  readJson("button_workflow_done_claim", "Validate the final button workflow done claim."),
];

export const SMALL_MODEL_TOOLS: readonly ToolSeed[] = [
  readJson("context_digest", "Return bounded file evidence snippets with citations for small-context models.", ["rg"]),
  readJson("session_preflight", "Return latest task checkpoint, verification tools, and small-context budget ledger."),
  readJson("orchestration_profile", "Return the small-context OpenCode orchestration profile."),
  readJson("qwen_retry_policy", "Return qwen3.6-35b-a3b public rate-limit retry and chunking guidance."),
  readJson("orchestration_health", "Summarize task and public-worker health with recovery steps that preserve progress."),
  writeState("rules_snapshot", "Write current Tiny-Chu architecture implementation patterns to .tiny/rules."),
  readJson("tool_usage_plan", "Choose a small-model-safe command and Tiny-Chu tool sequence for a task."),
  readJson("resume_packet", "Return the active task goal, latest checkpoint, next steps, and open questions."),
  readJson("task_focus_packet", "Return the current task plus plan focus and latest checkpoint."),
  readJson("chunked_write_plan", "Split large Markdown output into bounded write chunks before editing files."),
  writeState("git_weekly_report", "Write a five-business-day Git activity report under .tiny/reports/git-weekly."),
];

export const UX_REVERSE_ENGINEERING_TOOLS: readonly ToolSeed[] = [
  readJson("ui_layout_catalog", "Catalog source-code-first UX layout elements from React/JS/TS screens.", ["rg", "ast-grep"]),
  readJson("ux_rationale_trace", "Explain UI element existence and position with conservative evidence statuses.", ["rg"]),
  readJson("ux_validation_matrix", "Split UX field value kinds, client rules, server rules, and message evidence.", ["rg", "ast-grep"]),
  writeState("layout_truth_update", "Persist evidence-backed UX layout truth under .tiny/ux without downgrading verified facts."),
  readJson("layout_truth_verify", "Verify persisted layout truth against current source fingerprints."),
  markdown("layout_truth_report", "Render layout truth repository memory as Markdown."),
  markdown("ux_reverse_report", "Render UX reverse-engineering Markdown from catalog, rationale, and validation evidence."),
];

export const DOCTOR_ARTIFACT_TOOLS: readonly ToolSeed[] = [
  readJson("doctor", "Return a normalized Tiny-Chu health facade across environment, state, and session checks.", ["node"]),
  readJson("powershell_command_guard", "Validate generated native-tool commands for PowerShell-safe execution.", ["pwsh"]),
  readJson("trace_diagram_render", "Render Mermaid diagrams deterministically from traceability JSON.", ["mmdc"]),
  readJson("tiny_chu_install_check", "Summarize Tiny-Chu OpenCode plugin readiness and exposed tools."),
  readJson("environment_doctor", "Check OpenCode, Ollama, PowerShell, Node, and native analysis tool readiness.", ["node", "pwsh", "opencode", "ollama", "rg", "fd", "jq", "yq", "mdq", "ast-grep", "mmdc"]),
  markdown("artifact_format_template", "Return the required artifact format template before generation."),
  readJson("artifact_check", "Validate AS-IS, UI, story, testcase, Mermaid sequence/flow, and ERD artifacts against evidence rules."),
  readJson("mermaid_check", "Check Mermaid fenced blocks for common formatting and syntax issues.", ["mmdc"]),
  markdown("mermaid_fix", "Normalize Mermaid fenced blocks and close unclosed fences when deterministic."),
];

export const SAFE_TOOLING_TOOLS: readonly ToolSeed[] = [
  { ...readJson("safe_patch_check", "Validate an allowlisted unified diff with expected hashes without mutating source.", ["git"]), inputSchema: { type: "object", properties: { patch: STRING_SCHEMA, allowedTargets: STRING_ARRAY_SCHEMA, expectedFiles: OBJECT_SCHEMA }, required: ["patch", "allowedTargets", "expectedFiles"] } },
  { ...writeSource("safe_patch_apply", "Apply an allowlisted unified diff only after hash, path, and lock checks."), inputSchema: { type: "object", properties: { patch: STRING_SCHEMA, allowedTargets: STRING_ARRAY_SCHEMA, expectedFiles: OBJECT_SCHEMA }, required: ["patch", "allowedTargets", "expectedFiles"] } },
  { ...writeState("artifact_workspace_prepare", "Prepare an isolated OS-temp artifact workspace outside the source repository."), inputSchema: { type: "object", properties: { allowedInputs: STRING_ARRAY_SCHEMA, copyInputs: STRING_ARRAY_SCHEMA }, required: ["allowedInputs"] } },
  { ...writeState("artifact_workspace_commit", "Commit generated artifacts inside the isolated artifact workspace."), inputSchema: { type: "object", properties: { workspaceRoot: STRING_SCHEMA }, required: ["workspaceRoot"] } },
  { ...writeState("artifact_publish_manifest", "Write a durable manifest for allowlisted artifact publish operations."), inputSchema: { type: "object", properties: { workspaceRoot: STRING_SCHEMA, entries: { type: "array", items: OBJECT_SCHEMA }, allowedTargets: STRING_ARRAY_SCHEMA }, required: ["workspaceRoot", "entries", "allowedTargets"] } },
  { ...writeSource("artifact_publish_apply", "Publish artifact workspace files only when target hashes still match the manifest."), inputSchema: { type: "object", properties: { manifestPath: STRING_SCHEMA }, required: ["manifestPath"] } },
  readJson("powershell_toolchain_probe", "Probe pwsh behavior for OpenCode native tooling compatibility.", ["pwsh"]),
  readJson("run_diagnostics", "Run advisory build/test diagnostics without gating mutation tools."),
];

export const NATIVE_PREVIEW_TOOLS: readonly ToolSeed[] = [
  readJson("structural_search_ast", "Preview ast-grep structural search matches without writing source.", ["ast-grep"]),
  readJson("structural_rewrite_preview", "Preview ast-grep rewrite output and route mutation through safe_patch_apply.", ["ast-grep"]),
  readJson("json_yaml_transform_preview", "Preview jq or Mike Farah yq data transforms without writing source.", ["jq", "yq"]),
  readJson("json_patch_preview", "Preview jd JSON/YAML structural patch output for artifact publishing.", ["jd"]),
];
