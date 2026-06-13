export interface TinyChuInstallCheckResult {
  readonly packageName: "tiny-chu";
  readonly requiredTools: readonly string[];
  readonly opencodeEntrypoint: "./dist/opencode/plugin.js";
  readonly status: "ready";
}

export const DEFAULT_TINY_CHU_TOOL_NAMES = [
  "task_create", "task_get", "task_list", "task_checkpoint", "task_update",
  "public_dispatch", "public_collect", "public_checkpoint", "public_retry", "public_cancel",
  "public_complete",
  "context_bundle", "context_packet", "context_digest", "repo_map", "business_logic_map", "legacy_repo_index",
  "ui_action_trace", "api_backend_trace", "integration_catalog", "traceability_matrix", "evidence_qa", "evidence_snapshot",
  "doctor", "claim_evidence_check", "session_preflight", "powershell_command_guard", "trace_diagram_render", "tiny_chu_install_check",
  "environment_doctor", "api_contract_catalog", "dto_schema_map", "redux_state_flow_map", "auth_permission_trace",
  "error_transaction_map", "test_impact_planner", "worker_packet_optimizer", "artifact_pack_manifest", "incremental_evidence_cache",
  "ui_layout_catalog", "ux_rationale_trace", "ux_validation_matrix", "layout_truth_update", "layout_truth_verify", "layout_truth_report", "ux_reverse_report",
  "button_workflow_plan", "button_worker_packet", "button_workflow_dispatch", "markdown_envelope_check", "button_worker_result_check",
  "button_trace_aggregate", "aggregation_drift_check", "atomic_markdown_write", "write_loop_guard", "button_workflow_done_claim",
  "wiki_bundle", "orchestration_profile", "qwen_retry_policy", "orchestration_health", "rules_snapshot",
  "tool_usage_plan", "resume_packet", "task_focus_packet", "chunked_write_plan", "artifact_format_template", "artifact_check", "mermaid_check", "mermaid_fix",
] as const;

export function createTinyChuInstallCheck(toolNames: readonly string[] = DEFAULT_TINY_CHU_TOOL_NAMES): TinyChuInstallCheckResult {
  return {
    packageName: "tiny-chu",
    requiredTools: [...toolNames].sort(),
    opencodeEntrypoint: "./dist/opencode/plugin.js",
    status: "ready",
  };
}
