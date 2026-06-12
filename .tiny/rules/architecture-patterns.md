# Architecture Patterns

These rules are generated from the current Tiny-Chu implementation so future small-model work can reuse known patterns instead of rediscovering them.

## OpenCode tool bridge

- Public API additions are exported from src/index.ts after the implementation module exists.
- OpenCode tool bridge additions require both createTinyInfiPlugin() tool registration and TOOL_SPECS metadata in src/opencode/plugin.ts.
- Every new Tiny-Chu tool gets a behavior test through createTinyInfiPlugin() and a bridge-surface assertion in the OpenCode plugin test.
- File-backed orchestration state is resolved through resolveTinyInfiPaths() and remains under .tiny/.
- Small-model repository analysis starts with tool_usage_plan, repo_map, business_logic_map, context_digest, then artifact_check or mermaid_check.
- Long generated Markdown is planned with chunked_write_plan and resumed through task_checkpoint instead of one large model write.
- Qwen public delegate calls use qwen_retry_policy for the 20 rpm and 20000 tpm limits, then public_checkpoint and public_retry when recovery is needed.
- Checkpointed, failed, or retry_wait public jobs are checked with orchestration_health before declaring work complete.
- Legacy analysis additions follow the deterministic chain legacy_repo_index -> ui_action_trace -> api_backend_trace -> integration_catalog -> traceability_matrix -> evidence_qa.
- Legacy analysis tools return structured JSON by default and must not write .analysis/ files unless the caller explicitly requests persisted output.
- Missing Button/API/BE/DB/RFC links are represented as unknown or unmatched_endpoint; do not infer links without file and line evidence.

## Evidence refs

- src/opencode/tiny-plugin.ts
- src/opencode/plugin.ts
- src/index.ts
- test/small-model-resilience.test.mjs
- test/legacy-analysis.test.mjs
