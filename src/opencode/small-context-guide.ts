import { POWERSHELL_TOOLING_PROFILE } from "./powershell-tooling.js";
import type { SmallContextOrchestrationProfile } from "./small-context-profile.js";

export function renderSmallContextGuide(profile: SmallContextOrchestrationProfile): string {
  const tools = profile.contextStrategy.nativeTools.map((tool) => `- ${tool.name}: ${tool.command} — ${tool.purpose}`).join("\n");
  const passes = profile.contextStrategy.passes.map((pass) => `- ${pass}`).join("\n");
  const passContract = profile.auditLoop.passContract.map((rule) => `- ${rule}`).join("\n");
  const artifacts = profile.artifacts.map((artifact) => `- ${artifact.type}: ${artifact.requiredSections.length > 0 ? artifact.requiredSections.join(", ") : artifact.acceptedMermaidDeclarations.join(", ")}`).join("\n");
  const antiHallucination = profile.antiHallucination.rules.map((rule) => `- ${rule}`).join("\n");
  const delegatePacket = [
    `Must include: ${profile.delegatePacket.mustInclude.join(", ")}`,
    `Must return: ${profile.delegatePacket.mustReturn.join(", ")}`,
  ].join("\n");
  const qwen = [
    `Model: ${profile.models.delegate.model}`,
    `Limit: ${profile.qwenRateLimit.requestsPerMinute} requests/min, ${profile.qwenRateLimit.tokensPerMinute} tokens/min`,
    `Retry tool: ${profile.qwenRateLimit.retryTool}`,
  ].join("\n");
  const continuation = profile.continuationProtocol.rules.map((rule) => `- ${rule}`).join("\n");
  const mermaid = profile.mermaid.rules.map((rule) => `- ${rule}`).join("\n");
  const nativeToolNames = POWERSHELL_TOOLING_PROFILE.nativeTools.map((tool) => tool.name).join(", ");
  const templates = Object.keys(profile.agentTemplates).sort().join(", ");
  return [
    "# Tiny Infi small-context orchestration",
    `Foreman: ${profile.models.foreman.provider}/${profile.models.foreman.model}`,
    `Delegate: ${profile.models.delegate.provider}/${profile.models.delegate.model}`,
    `Agent templates: ${templates}`,
    `Packet tools: ${profile.packetStrategy.tools.join(", ")} maxContextChars=${profile.packetStrategy.maxContextChars}`,
    `PowerShell native tools already profiled: ${nativeToolNames}`,
    "## Context passes",
    passes,
    `## 20-pass audit loop\nTotal passes: ${profile.auditLoop.totalPasses}\n${passContract}`,
    "## Artifact contracts",
    artifacts,
    "## Anti-hallucination rules",
    antiHallucination,
    "## Qwen delegate packet",
    delegatePacket,
    "## Qwen public rate limits",
    qwen,
    "## Native workflow tools",
    tools,
    "## Continuation checkpoint",
    profile.continuationProtocol.checkpointTemplate,
    continuation,
    "## Mermaid discipline",
    profile.mermaid.workflow,
    mermaid,
  ].join("\n\n");
}
