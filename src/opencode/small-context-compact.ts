import { POWERSHELL_TOOLING_PROFILE } from "./powershell-tooling.js";
import type { SmallContextOrchestrationProfile } from "./small-context-profile.js";

const PRIORITY_PASSES = 8;
const PRIORITY_RULES = 6;

export interface CompactSmallContextGuide {
  readonly profileMode: "compact";
  readonly text: string;
  readonly omittedContextPasses: number;
  readonly omittedAntiHallucinationRules: number;
  readonly omittedArtifactContracts: number;
}

export function renderCompactSmallContextGuide(profile: SmallContextOrchestrationProfile): CompactSmallContextGuide {
  const passes = profile.contextStrategy.passes.slice(0, PRIORITY_PASSES);
  const rules = profile.antiHallucination.rules.slice(0, PRIORITY_RULES);
  const nativeToolNames = POWERSHELL_TOOLING_PROFILE.nativeTools.map((tool) => tool.name).join(", ");
  const text = [
    "# Tiny-Chu compact small-context orchestration",
    "profileMode: compact",
    `Foreman: ${profile.models.foreman.provider}/${profile.models.foreman.model}`,
    `Delegate: ${profile.models.delegate.provider}/${profile.models.delegate.model}`,
    `Budget: input<=${profile.models.foreman.inputTokenTarget}, output<=${profile.models.foreman.outputTokenTarget}, openFiles<=3`,
    `PowerShell tools: ${nativeToolNames}`,
    `Packet tools: ${profile.packetStrategy.tools.join(", ")}`,
    "## Required loop",
    "- Start with tool_usage_plan and follow its visible steps, omittedSteps, deterministicCaps, and verification block.",
    "- Use context_packet, task_focus_packet, context_digest, repo_map, business_logic_map, and trace catalogs instead of full-file prompts.",
    "- Use worker_packet_optimizer before public_dispatch and qwen_retry_policy on Qwen rate-limit or failure.",
    "- Call artifact_format_template before artifact generation, then artifact_check after generation.",
    "- For source edits, use safe_patch_check before safe_patch_apply; for generated docs, publish from artifact workspace manifests.",
    "- Use task_checkpoint before delegation, long writes, compaction, interruption, and final output.",
    "## Priority context passes",
    ...passes.map((pass) => `- ${pass}`),
    "## Priority anti-hallucination rules",
    ...rules.map((rule) => `- ${rule}`),
    "## Omitted full-profile counts",
    `omittedContextPasses: ${Math.max(0, profile.contextStrategy.passes.length - passes.length)}`,
    `omittedAntiHallucinationRules: ${Math.max(0, profile.antiHallucination.rules.length - rules.length)}`,
    `omittedArtifactContracts: ${profile.artifacts.length}`,
    "Use orchestration_profile only when the compact guide lacks a required contract detail.",
  ].join("\n");
  return {
    profileMode: "compact",
    text,
    omittedContextPasses: Math.max(0, profile.contextStrategy.passes.length - passes.length),
    omittedAntiHallucinationRules: Math.max(0, profile.antiHallucination.rules.length - rules.length),
    omittedArtifactContracts: profile.artifacts.length,
  };
}
