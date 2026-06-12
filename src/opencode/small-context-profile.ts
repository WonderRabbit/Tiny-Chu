import { ARTIFACT_CONTRACTS, type ArtifactContract } from "./artifact-contract.js";
import { POWERSHELL_TOOLING_PROFILE } from "./powershell-tooling.js";

export interface NativeWorkflowTool {
  readonly name: string;
  readonly command: string;
  readonly purpose: string;
}

export interface SmallContextModelProfile {
  readonly provider: "ollama" | "opencode-agent";
  readonly model: string;
  readonly role: string;
  readonly inputTokenTarget: number;
  readonly outputTokenTarget: number;
}

export interface SmallContextOrchestrationProfile {
  readonly runtime: {
    readonly shell: {
      readonly name: string;
      readonly executable: string;
      readonly version: string;
      readonly args: readonly string[];
    };
  };
  readonly models: {
    readonly foreman: SmallContextModelProfile;
    readonly delegate: SmallContextModelProfile;
  };
  readonly contextStrategy: {
    readonly nativeTools: readonly NativeWorkflowTool[];
    readonly passes: readonly string[];
  };
  readonly auditLoop: {
    readonly totalPasses: number;
    readonly passContract: readonly string[];
  };
  readonly artifacts: readonly ArtifactContract[];
  readonly antiHallucination: {
    readonly rules: readonly string[];
  };
  readonly delegatePacket: {
    readonly mustInclude: readonly string[];
    readonly mustReturn: readonly string[];
  };
  readonly continuationProtocol: {
    readonly checkpointTemplate: string;
    readonly rules: readonly string[];
  };
  readonly mermaid: {
    readonly workflow: string;
    readonly rules: readonly string[];
  };
}

export interface RuntimeSnapshot {
  readonly shell: {
    readonly name: string;
    readonly executable: string;
    readonly version: string;
    readonly args: readonly string[];
  };
}

const CONTEXT_TOOLS: readonly NativeWorkflowTool[] = [
  { name: "fd", command: "fd --type f --hidden --exclude .git --exclude node_modules --exclude dist", purpose: "Build a bounded file inventory before reading content." },
  { name: "ripgrep", command: "rg --json --line-number --column --no-heading '<term>' <paths>", purpose: "Find text evidence with machine-readable locations." },
  { name: "ast-grep", command: "ast-grep run --lang ts -p '<pattern>' src", purpose: "Find TypeScript syntax shapes without regex overmatching." },
  { name: "jq", command: "jq -c '<filter>' file.json", purpose: "Slice JSON state, package metadata, and worker packets." },
  { name: "yq", command: "yq -o json '<expr>' file.yml", purpose: "Convert structured config to compact JSON for small models." },
  { name: "mdq", command: "mdq --output json '<selector>' file.md", purpose: "Extract Markdown headings, checkboxes, and code fences deterministically." },
  { name: "mermaid-cli", command: "mmdc -i diagram.mmd -o diagram.svg", purpose: "Validate Mermaid diagrams through the real renderer before publishing." },
];

export function createSmallContextOrchestrationProfile(runtime: RuntimeSnapshot): SmallContextOrchestrationProfile {
  return {
    runtime: {
      shell: runtime.shell,
    },
    models: {
      foreman: {
        provider: "ollama",
        model: "gemma4-small",
        role: "local foreman that plans, checkpoints, and routes narrow evidence packets",
        inputTokenTarget: 1800,
        outputTokenTarget: 700,
      },
      delegate: {
        provider: "opencode-agent",
        model: "qwen3.6-35b-a3b",
        role: "large analysis/design/artifact worker for source reading and synthesis",
        inputTokenTarget: 12000,
        outputTokenTarget: 4000,
      },
    },
    contextStrategy: {
      nativeTools: CONTEXT_TOOLS,
      passes: [
        "inventory with fd before opening files",
        "rank evidence with rg --json and ast-grep structural matches",
        "use context_digest for bounded cited snippets instead of full-file reads",
        "slice JSON/YAML/Markdown with jq, yq, and mdq instead of full-file prompts",
        "delegate only compact packets with objective, files, evidence, and must-return fields",
        "use chunked_write_plan before writing long Markdown or generated artifacts",
        "checkpoint every completed pass with summary, nextSteps, evidenceRefs, and openQuestions",
      ],
    },
    auditLoop: {
      totalPasses: 20,
      passContract: [
        "review the current evidence map",
        "plan one bounded improvement",
        "apply or record why no code change is needed",
        "validate through artifact_check, mermaid_check, and task_checkpoint where relevant",
        "checkpoint passIndex, artifactType, evidenceRefs, verificationCommands, nextSteps, and openQuestions",
      ],
    },
    artifacts: ARTIFACT_CONTRACTS,
    antiHallucination: {
      rules: [
        "Every claim must cite a file path with line, a command transcript, or an evidenceRef.",
        "If evidence is missing, write an uncertainty or openQuestion instead of guessing.",
        "Use context_digest before claiming repository facts from source files.",
        "Never accept AS-IS, UI, story, testcase, sequence, flowchart, or ERD output until artifact_check is valid.",
        "Prefer jq, yq, mdq, fd, ast-grep, and rg outputs over model-only summaries for repository facts.",
      ],
    },
    delegatePacket: {
      mustInclude: ["objective", "artifactType", "boundedFiles", "evidenceRefs", "knownUncertainties", "mustReturn"],
      mustReturn: ["artifactMarkdown", "citations", "uncertainties", "verificationCommands", "nextSteps"],
    },
    continuationProtocol: {
      checkpointTemplate: '{"summary":"...","artifactType":"as_is","passIndex":1,"nextSteps":["..."],"evidenceRefs":["..."],"openQuestions":["..."],"verificationCommands":["..."]}',
      rules: [
        "write a checkpoint before delegating, before long-running commands, and after every returned artifact",
        "resume from the newest checkpoint instead of re-reading full files",
        "call resume_packet when a session starts, after compaction, or after interruption",
        "keep one active next step small enough for the foreman model to finish in one turn",
      ],
    },
    mermaid: {
      workflow: "extract fenced mermaid blocks with mdq, normalize fences, run mmdc -i <block>.mmd -o <block>.svg, then store diagnostics as evidence",
      rules: [
        "use lowercase ```mermaid fences",
        "close every fence before prose resumes",
        "validate with mermaid-cli when mmdc is installed",
        "keep source diagrams in Markdown and renderer output out of prompts unless needed",
      ],
    },
  };
}

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
  const continuation = profile.continuationProtocol.rules.map((rule) => `- ${rule}`).join("\n");
  const mermaid = profile.mermaid.rules.map((rule) => `- ${rule}`).join("\n");
  const nativeToolNames = POWERSHELL_TOOLING_PROFILE.nativeTools.map((tool) => tool.name).join(", ");
  return [
    "# Tiny Infi small-context orchestration",
    `Foreman: ${profile.models.foreman.provider}/${profile.models.foreman.model}`,
    `Delegate: ${profile.models.delegate.provider}/${profile.models.delegate.model}`,
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
