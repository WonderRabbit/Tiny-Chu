import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveTinyChuPaths } from "../state/paths.js";

export interface RulesSnapshotResult {
  readonly path: ".tiny/rules/architecture-patterns.md";
  readonly rules: readonly string[];
  readonly evidenceRefs: readonly string[];
}

const DEFAULT_RULES: readonly string[] = [
  "Public API additions are exported from src/index.ts only when they are intentional public ABI changes backed by ABI tests.",
  "OpenCode tool bridge additions are registered through TinyFeaturePackage descriptors; plugin.ts and install-check.ts consume the generated registry.",
  "Every new Tiny-Chu tool gets a behavior test, a feature-package owner, and direct/OpenCode/install-check parity coverage.",
  "File-backed orchestration state is resolved through resolveTinyChuPaths() and remains under .tiny/.",
  "Small-model repository analysis starts with tool_usage_plan, repo_map, business_logic_map, context_digest, then artifact_check or mermaid_check.",
  "Long generated Markdown is planned with chunked_write_plan and resumed through task_checkpoint instead of one large model write.",
  "Qwen public delegate calls use qwen_retry_policy for the 20 rpm and 20000 tpm limits, then public_checkpoint and public_retry when recovery is needed.",
  "Checkpointed, failed, or retry_wait public jobs are checked with orchestration_health before declaring work complete.",
];

const STACK_PROFILE_RULES: readonly string[] = [
  "TypeScript stack profile: keep ESM imports explicit, prefer readonly interfaces for stored JSON, and expose intentional ABI through src/index.ts.",
  "Node stack profile: prefer Node built-ins for file, path, HTTP metadata, and test-runner work; do not add npm dependencies for orchestration helpers.",
  "OpenCode stack profile: local provider checks use provider_endpoint_preflight metadata routes only; chat or generation calls are not used as readiness proof.",
  "Workflow stack profile: repository analysis starts with analysis_workflow_start and must finish through workflow_sot_audit before final user-facing claims.",
];

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map(String).filter((item) => item.trim() !== "") : [];
}

function markdown(rules: readonly string[], evidenceRefs: readonly string[]): string {
  const ruleLines = rules.map((rule) => `- ${rule}`).join("\n");
  const evidence = evidenceRefs.length > 0 ? evidenceRefs.map((ref) => `- ${ref}`).join("\n") : "- generated from current Tiny-Chu architecture";
  return [
    "# Architecture Patterns",
    "",
    "These rules are generated from the current Tiny-Chu implementation so future small-model work can reuse known patterns instead of rediscovering them.",
    "",
    "## OpenCode tool bridge",
    "",
    ruleLines,
    "",
    "## Evidence refs",
    "",
    evidence,
    "",
  ].join("\n");
}

export async function writeRulesSnapshot(root: string | undefined, input: Record<string, unknown>): Promise<RulesSnapshotResult> {
  const paths = resolveTinyChuPaths(root);
  const rules = stringList(input.rules);
  const evidenceRefs = stringList(input.evidenceRefs);
  const baseRules = rules.length > 0 ? rules : DEFAULT_RULES;
  const mergedRules = input.includeStackProfiles === true ? [...baseRules, ...STACK_PROFILE_RULES] : baseRules;
  const rulesDir = path.join(paths.tinyDir, "rules");
  const file = path.join(rulesDir, "architecture-patterns.md");
  await mkdir(rulesDir, { recursive: true });
  await writeFile(file, markdown(mergedRules, evidenceRefs), "utf8");
  return {
    path: ".tiny/rules/architecture-patterns.md",
    rules: mergedRules,
    evidenceRefs,
  };
}
