# Architecture Patterns

These rules are generated from the current Tiny-Chu implementation so future small-model work can reuse known patterns instead of rediscovering them.

## OpenCode tool bridge

- Public API additions are exported from src/index.ts only when they are intentional public ABI changes backed by ABI tests.
- OpenCode tool bridge additions are registered through TinyFeaturePackage descriptors; plugin.ts and install-check.ts consume the generated registry.
- Every new Tiny-Chu tool gets a behavior test, a feature-package owner, and direct/OpenCode/install-check parity coverage.
- File-backed orchestration state is resolved through resolveTinyChuPaths() and remains under .tiny/.
- Small-model repository analysis starts with tool_usage_plan, repo_map, business_logic_map, context_digest, then artifact_check or mermaid_check.
- Long generated Markdown is planned with chunked_write_plan and resumed through task_checkpoint instead of one large model write.
- Qwen public delegate calls use qwen_retry_policy for the 20 rpm and 20000 tpm limits, then public_checkpoint and public_retry when recovery is needed.
- Checkpointed, failed, or retry_wait public jobs are checked with orchestration_health before declaring work complete.
- Legacy analysis additions follow the deterministic chain legacy_repo_index -> ui_action_trace -> api_backend_trace -> integration_catalog -> traceability_matrix -> evidence_qa.
- Legacy analysis tools return structured JSON by default and must not write .analysis/ files unless the caller explicitly requests persisted output.
- Missing Button/API/BE/DB/RFC links are represented as unknown or unmatched_endpoint; do not infer links without file and line evidence.
- tool_usage_plan keeps a small visible step list, but the non-truncatable verification.requiredTools block must run after work before stopping.
- tool_usage_plan exposes omittedSteps, nextRequiredTool, and deterministicCaps so small foreman models can continue capped plans without treating the visible list as complete.
- ulw/ultrawork prompt injection uses compact PowerShell and small-context guides by default; full profiles stay available through explicit exported renderers and orchestration_profile.
- OpenCode bridge output applies maxOutputChars and maxArrayItems as a final model-facing budget, while direct createTinyChuPlugin() tool calls preserve full structured return values.
- Linked flow tools must bound both sides before pair generation and report omittedLinks instead of building large cartesian products and slicing afterward.
- New target repositories start with environment_doctor, then session_preflight when a task id exists, before broad analysis.
- Detailed design evidence uses api_contract_catalog, dto_schema_map, redux_state_flow_map, auth_permission_trace, and error_transaction_map before model-written TO-BE claims.
- Public Qwen delegation is packetized through worker_packet_optimizer before public_dispatch when evidence refs or files may exceed the model budget.
- Generated artifacts with named symbols must pass claim_evidence_check; trace diagrams should be rendered from trace_diagram_render rather than free-form Mermaid.
- Reused repository facts are checked with incremental_evidence_cache; stale results require rerunning legacy_repo_index, repo_map, or business_logic_map.
- Resumed small-context runs use context_packet and task_focus_packet instead of re-reading full context after compaction.
- New task checkpoints are appended to .tiny/tasks/<task-id>.checkpoints.jsonl; TaskStore.get/list merge legacy inline and sidecar checkpoints.
- Artifact generation must call artifact_format_template before drafting and artifact_check after drafting; project overrides live under .tiny/artifacts/templates.
- Multi-button workflows must stay one button per worker: button_workflow_plan -> button_worker_packet/button_workflow_dispatch -> markdown_envelope_check/button_worker_result_check -> public_complete -> button_trace_aggregate -> aggregation_drift_check -> button_workflow_done_claim.
- Tiny-Chu-owned generated Markdown writes use write_loop_guard and atomic_markdown_write; no .bak files are part of the normal write path.
- doctor is the canonical readiness facade; environment_doctor remains the command-specific check and orchestration_health remains the recovery check.
- Agent model option metadata is data-only under orchestration_profile.agentTemplates; provider schemas validate options without live provider API calls.
- evidence_snapshot summarizes existing evidence files for reuse metadata; it is bounded and does not replace source freshness checks.

## UI/UX reverse engineering and layout truth policy

- B2B admin web and mobile web screen analysis follows `purpose -> state -> data -> action -> feedback -> record` before accepting a layout decision.
- Run `layout_truth_verify before reuse` whenever saved `.tiny/ux/layout-truth.json` rationale is used for a new UI/UX design or reverse-engineering pass.
- Treat stale/missing layout truth records as review targets, not reusable design facts.
- A source-order-only position rationale must not be marked Verified; it can be Inferred or Needs Verification until direct layout or cross-layer evidence exists.
- A convention-only position rationale must not be marked Verified; admin-screen convention is useful context, not proof.
- `layout_truth_update` only persists records with source evidence refs that resolve to current file-line fingerprints inside the project root.
- UI/UX layout truth should explain why the element exists, why it is placed there, which value settings or validation apply, and which action/event flow follows from the control.
- Desktop B2B admin defaults are dense but scannable: persistent shell, explicit search/filter/sort, table-first result review, row selection, bulk action guardrails, object detail drill-down, status/exception visibility, and audit/history access.
- Mobile web defaults are task-first: one primary task per screen, large touch targets, minimal navigation chrome, short forms, explicit confirmation for high-cost actions, resilient draft/offline/sync states, and stacked summaries instead of wide tables.
- Button and event-flow rationale must name the trigger, state mutation, request/data dependency, feedback message, retry/error path, and record/audit effect when source evidence exists.
- Product taste, visual preference, or design-system convention can be recorded as a candidate note, but cannot become layout truth without source, runtime, design-file, or reviewed layout evidence.

## Evidence refs

- src/opencode/tiny-plugin.ts
- src/opencode/plugin.ts
- src/opencode/output-budget.ts
- src/opencode/small-context-compact.ts
- src/opencode/extension-flow.ts
- src/opencode/tool-plan.ts
- src/opencode/doctor.ts
- src/opencode/button-workflow.ts
- src/opencode/agent-model-options.ts
- src/context/evidence-packet.ts
- src/index.ts
- test/small-model-resilience.test.mjs
- test/extension-tools.test.mjs
- test/opencode-plugin.test.mjs
- test/legacy-analysis.test.mjs
