export interface DeterministicToolCap {
  readonly name: string;
  readonly maxItems: number;
  readonly purpose: string;
}

export const DETERMINISTIC_CAPS: readonly DeterministicToolCap[] = [
  { name: "fd", maxItems: 80, purpose: "file inventory paths returned to the foreman model" },
  { name: "ripgrep", maxItems: 20, purpose: "text evidence matches returned per query" },
  { name: "ast-grep", maxItems: 20, purpose: "structural matches returned per pattern" },
  { name: "context_digest", maxItems: 12, purpose: "cited snippets returned instead of full file reads" },
  { name: "evidence_snapshot", maxItems: 20, purpose: "existing evidence files summarized for reuse" },
  { name: "redux_state_flow_map", maxItems: 80, purpose: "state facts and linked flow rows after pre-link bounding" },
  { name: "auth_permission_trace", maxItems: 80, purpose: "permission conditions and linked rows after pre-link bounding" },
  { name: "worker_packet_optimizer", maxItems: 6, purpose: "Qwen packets produced before public_dispatch" },
  { name: "chunked_write_plan", maxItems: 2000, purpose: "characters per generated artifact write chunk" },
  { name: "safe_patch_check", maxItems: 20, purpose: "source files checked per allowlisted patch before safe_patch_apply" },
  { name: "artifact_publish_manifest", maxItems: 20, purpose: "artifact files published through stale-target manifests" },
];
