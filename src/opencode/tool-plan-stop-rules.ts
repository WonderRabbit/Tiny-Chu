export function repositoryAnalysisStopRules(enabled: boolean): readonly string[] {
  return enabled
    ? [
        "start repository analysis with analysis_workflow_start before waiting for model output",
        "run provider_endpoint_preflight without chat generation before trusting local model availability",
        "run workflow_progress_heartbeat instead of silently waiting when progress is unclear",
        "run workflow_sot_audit before final output so the answer cites workflow state and evidence",
      ]
    : [];
}

export function smallContextCorrectionStopRules(enabled: boolean): readonly string[] {
  return enabled
    ? [
        "no live provider calls are proof for this workflow; Tiny-Chu must stay local and packet-only",
        "call worker_packet_optimizer with dispatch:false before any public Qwen queue path",
        "do not treat incremental_evidence_cache as git dirtiness; run git status --short and git diff -- <file> outside library code",
      ]
    : [];
}

export const BASE_STOP_RULES: readonly string[] = [
  "do not read full files when repo_map or context_digest can answer",
  "do not ask the model to infer variables columns or comparisons before business_logic_map",
  "do not abandon public Qwen failures; use qwen_retry_policy then public_retry",
  "use worker_packet_optimizer before public_dispatch when evidence packets may exceed the small-model budget",
  "run orchestration_health after retries, interruptions, or failed worker jobs",
  "run claim_evidence_check before accepting named APIs, classes, tables, or RFCs in an artifact",
  "for source edits, preview or construct a patch, run safe_patch_check, then use safe_patch_apply only with expected hashes",
  "for generated docs or reports, prepare an artifact workspace, create artifact_publish_manifest, then publish with artifact_publish_apply",
  "do not produce artifact claims without evidenceRefs",
  "do not stop after implementation; run the verification tools from the verification block",
  "checkpoint before delegation, long commands, compaction, and final output",
];
