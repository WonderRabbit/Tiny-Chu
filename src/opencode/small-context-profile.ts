import { ARTIFACT_CONTRACTS, type ArtifactContract } from "./artifact-contract.js";
import { createDefaultAgentModelTemplates, type AgentKind, type AgentModelTemplate } from "./agent-model-options.js";
import { createSmallContextRunGate, DEFAULT_SMALL_CONTEXT_MODELS, type SmallContextRunGate } from "./small-context-run.js";

export { renderSmallContextGuide } from "./small-context-guide.js";

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
  readonly smallContextRun: SmallContextRunGate;
  readonly agentTemplates: Readonly<Record<AgentKind, AgentModelTemplate>>;
  readonly packetStrategy: {
    readonly tools: readonly ["context_packet", "task_focus_packet"];
    readonly maxContextChars: number;
    readonly maxEvidenceChars: number;
    readonly citationRequired: boolean;
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
  readonly qwenRateLimit: {
    readonly requestsPerMinute: number;
    readonly tokensPerMinute: number;
    readonly retryTool: string;
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
  const models = DEFAULT_SMALL_CONTEXT_MODELS;
  return {
    runtime: {
      shell: runtime.shell,
    },
    models,
    smallContextRun: createSmallContextRunGate(models),
    agentTemplates: createDefaultAgentModelTemplates(),
    packetStrategy: {
      tools: ["context_packet", "task_focus_packet"],
      maxContextChars: 6000,
      maxEvidenceChars: 1200,
      citationRequired: true,
    },
    contextStrategy: {
      nativeTools: CONTEXT_TOOLS,
      passes: [
        "start with tool_usage_plan to choose the smallest safe command/tool sequence",
        "run environment_doctor when entering a new Windows/OpenCode/Ollama target repository",
        "inventory with fd before opening files",
        "build a bounded architecture and UI-to-database flow sketch with repo_map",
        "use legacy_repo_index before Button-to-API-to-DB/RFC legacy tracing",
        "use ui_action_trace, api_backend_trace, integration_catalog, traceability_matrix, then evidence_qa for legacy enterprise flow analysis",
        "use ui_layout_catalog, ux_rationale_trace, ux_validation_matrix, ux_reverse_report, then layout_truth_update for source-code-first UX reverse analysis",
        "run layout_truth_verify before reusing saved UI/UX layout reasons from .tiny/ux/layout-truth.json",
        "use api_contract_catalog, dto_schema_map, redux_state_flow_map, auth_permission_trace, and error_transaction_map for design-detail gaps",
        "extract variables, columns, and comparison evidence with business_logic_map before explaining complex business rules",
        "rank evidence with rg --json and ast-grep structural matches",
        "use context_digest for bounded cited snippets instead of full-file reads",
        "use context_packet and task_focus_packet before resuming after compaction or interruption",
        "slice JSON/YAML/Markdown with jq, yq, and mdq instead of full-file prompts",
        "call qwen_retry_policy before or after public delegation when the shared Qwen limit may be hit",
        "use worker_packet_optimizer to split Qwen packets before public_dispatch",
        "delegate only compact packets with objective, files, evidence, and must-return fields",
        "use incremental_evidence_cache before reusing old repo-map or trace evidence",
        "use chunked_write_plan before writing long Markdown or generated artifacts",
        "use safe_patch_check before safe_patch_apply for source edits when safeTooling is enabled",
        "use artifact_workspace_prepare and artifact_publish_manifest before artifact_publish_apply for generated docs or reports",
        "use artifact_pack_manifest before publishing grouped AS-IS, TO-BE, UI, story, testcase, Mermaid, and ERD outputs",
        "check orchestration_health after failures, interruptions, or retry waits",
        "write rules_snapshot after architecture patterns are confirmed",
        "after work is produced, run the tool_usage_plan verification block even when the visible step list is capped",
        "call artifact_format_template before artifact generation, then artifact_check after generation",
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
        "Use context_packet and task_focus_packet instead of re-reading full context after compaction.",
        "Use repo_map before explaining architecture, web UI entry points, API handlers, or database writes.",
        "Use legacy_repo_index and evidence_qa before accepting Button-to-Saga-to-API-to-BE-to-DB/RFC traceability.",
        "Use ui_layout_catalog and layout_truth_verify before claiming why a search condition or result field exists or is positioned there.",
        "Use claim_evidence_check before accepting named APIs, classes, tables, mapper ids, or RFCs in generated artifacts.",
        "Use trace_diagram_render instead of free-form Mermaid when a trace matrix exists.",
        "Use safe_patch_check before safe_patch_apply for source writes; direct overwrite is not the small-model-safe path.",
        "Use artifact workspace and manifest publish tools for generated docs/reports so construction Git stays outside the source repository.",
        "Use powershell_command_guard before running model-generated native commands.",
        "Use dto_schema_map, redux_state_flow_map, auth_permission_trace, and error_transaction_map before detailed TO-BE impact claims.",
        "Use business_logic_map before claiming detailed business rules, variable relationships, or column comparisons.",
        "Use tool_usage_plan when unsure which native command or Tiny-Chu tool should run next.",
        "Never treat a bounded step list as complete until its verification.requiredTools have run.",
        "Use qwen_retry_policy for qwen3.6-35b-a3b delegation; the public limit is 20 requests/min and 20000 tokens/min.",
        "Use orchestration_health before declaring a stopped or failed run unrecoverable.",
        "Never accept AS-IS, UI, UX reverse, story, testcase, sequence, flowchart, or ERD output until artifact_check is valid.",
        "Call artifact_format_template before drafting an artifact so format requirements are explicit.",
        "Prefer jq, yq, mdq, fd, ast-grep, and rg outputs over model-only summaries for repository facts.",
      ],
    },
    delegatePacket: {
      mustInclude: ["objective", "artifactType", "boundedFiles", "evidenceRefs", "knownUncertainties", "mustReturn"],
      mustReturn: ["artifactMarkdown", "citations", "uncertainties", "verificationCommands", "nextSteps"],
    },
    qwenRateLimit: {
      requestsPerMinute: 20,
      tokensPerMinute: 20_000,
      retryTool: "qwen_retry_policy",
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
