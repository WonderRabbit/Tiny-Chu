import type { ArtifactType } from "./artifact-contract.js";
import { createDefaultAgentModelTemplates, type AgentKind, validateAgentModelTemplate, type AgentModelTemplateValidation } from "./agent-model-options.js";
import type { TinyChuRuntimeMode } from "./runtime-mode.js";
import { DETERMINISTIC_CAPS, type DeterministicToolCap } from "./tool-plan-caps.js";
import { applyToolPlanRuntimeMode } from "./tool-plan-runtime-mode.js";
import { BASE_STOP_RULES, repositoryAnalysisStopRules, smallContextCorrectionStopRules } from "./tool-plan-stop-rules.js";
export interface ToolPlanStep {
  readonly order: number;
  readonly goal: string;
  readonly nativeTool?: string;
  readonly tinyTool?: string;
  readonly command?: string;
  readonly outputBudget: string;
}

export interface ToolUsagePlanResult {
  readonly objective: string;
  readonly artifactType?: string;
  readonly modelBudget: {
    readonly maxInputTokens: number;
    readonly maxOutputTokens: number;
    readonly maxOpenFiles: number;
  };
  readonly steps: readonly ToolPlanStep[];
  readonly omittedSteps: number;
  readonly nextRequiredTool?: string;
  readonly agentKind?: AgentKind;
  readonly modelOptionValidation?: AgentModelTemplateValidation;
  readonly deterministicCaps: readonly DeterministicToolCap[];
  readonly reuseEvidence: readonly {
    readonly tool: "evidence_snapshot" | "incremental_evidence_cache";
    readonly purpose: string;
  }[];
  readonly verification: {
    readonly requiredAfterWork: boolean;
    readonly requiredTools: readonly string[];
    readonly requiredEvidence: readonly string[];
  };
  readonly stopRules: readonly string[];
}

const MAX_VISIBLE_STEPS = 8;

function textInput(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function artifactType(value: unknown): ArtifactType | undefined {
  switch (value) {
    case "as_is":
    case "ui_definition":
    case "sequence_diagram":
    case "flowchart":
    case "user_story":
    case "test_case":
    case "erd":
    case "ux_reverse_analysis":
      return value;
    default:
      return undefined;
  }
}

function mermaidStep(type: ArtifactType | undefined): ToolPlanStep | undefined {
  if (type !== "sequence_diagram" && type !== "flowchart" && type !== "erd") return undefined;
  return {
    order: 7,
    goal: "validate Mermaid before accepting artifact",
    nativeTool: "mermaid-cli",
    tinyTool: "mermaid_check",
    command: "mmdc -i <diagram>.mmd -o <diagram>.svg",
    outputBudget: "renderer exit code plus first diagnostic only",
  };
}

function needsQwenPolicy(objective: string): boolean {
  return /\b(qwen|public|delegate|retry|rate|limit|fail|health)\b/i.test(objective);
}

function needsLegacyTrace(objective: string): boolean {
  return /\b(button|ui|saga|api|backend|mybatis|rfc|traceability|database|db)\b/i.test(objective);
}

function needsUxReverse(objective: string, type: ArtifactType | undefined): boolean {
  return type === "ux_reverse_analysis" || /\b(ux|layout truth|screen composition|search condition|result field)\b/i.test(objective);
}

function needsSmallContextCorrection(objective: string): boolean {
  return /\b(small-context|small context|operating-mode|operating mode|small model optimization|provider call)\b/i.test(objective);
}

function needsRepositoryAnalysisWorkflow(objective: string): boolean {
  return /\b(repository|repo|opencode|gemma4|gemma|tiny-chu)\b/i.test(objective);
}

function artifactTemplateStep(): ToolPlanStep {
  return { order: 1, goal: "load required artifact format template", tinyTool: "artifact_format_template", outputBudget: "template sections, validation rules, and source only" };
}

function legacySteps(type: ArtifactType | undefined, qwen: boolean): ToolPlanStep[] {
  const mermaid = mermaidStep(type);
  const template = type ? artifactTemplateStep() : undefined;
  const qwenStep: ToolPlanStep = { order: 9, goal: "calculate Qwen wait retry and chunking", tinyTool: "qwen_retry_policy", outputBudget: "limits, retryDelaysMs, recovery protocol" };
  if (qwen && template && mermaid) {
    return [
      template,
      { order: 2, goal: "build deterministic legacy evidence index", tinyTool: "legacy_repo_index", outputBudget: "bounded JSON facts with file and line evidence" },
      { order: 3, goal: "trace UI event to Redux Saga and API client", tinyTool: "ui_action_trace", outputBudget: "one trace row with Unknown gaps" },
      { order: 4, goal: "trace API endpoint to backend service", tinyTool: "api_backend_trace", outputBudget: "route, service, mapper, RFC links only when verified" },
      { order: 5, goal: "merge verified links into traceability matrix", tinyTool: "traceability_matrix", outputBudget: "JSON rows plus Markdown table" },
      { order: 6, goal: "audit trace for hallucinated symbols and missing evidence", tinyTool: "evidence_qa", outputBudget: "blockers, warnings, required fixes" },
      qwenStep,
      mermaid,
      { order: 10, goal: "validate final artifact contract", tinyTool: "artifact_check", outputBudget: "valid flag and diagnostics only" },
      { order: 11, goal: "checkpoint continuation state", tinyTool: "task_checkpoint", outputBudget: "summary, nextSteps, evidenceRefs, openQuestions" },
    ];
  }
  const steps: ToolPlanStep[] = [
    ...(template ? [template] : []),
    { order: 1, goal: "inventory candidate files", nativeTool: "fd", command: "fd --type f --hidden --exclude .git --exclude node_modules --exclude dist", outputBudget: "top 80 paths only" },
    { order: 2, goal: "build deterministic legacy evidence index", tinyTool: "legacy_repo_index", outputBudget: "bounded JSON facts with file and line evidence" },
    { order: 3, goal: "trace UI event to Redux Saga and API client", tinyTool: "ui_action_trace", outputBudget: "one trace row with Unknown gaps" },
    { order: 4, goal: "trace API endpoint to backend service", tinyTool: "api_backend_trace", outputBudget: "route, service, mapper, RFC links only when verified" },
    { order: 5, goal: "catalog MyBatis and RFC integration evidence", tinyTool: "integration_catalog", outputBudget: "DB/RFC catalog summary" },
    { order: 6, goal: "merge verified links into traceability matrix", tinyTool: "traceability_matrix", outputBudget: "JSON rows plus Markdown table" },
    { order: 7, goal: "audit trace for hallucinated symbols and missing evidence", tinyTool: "evidence_qa", outputBudget: "blockers, warnings, required fixes" },
    ...(!template && mermaid ? [mermaid] : []),
    { order: 8, goal: "validate final artifact contract", tinyTool: "artifact_check", outputBudget: "valid flag and diagnostics only" },
    { order: 9, goal: "checkpoint continuation state", tinyTool: "task_checkpoint", outputBudget: "summary, nextSteps, evidenceRefs, openQuestions" },
  ];
  if (!qwen) return steps;
  return steps.filter((step) => step.nativeTool !== "fd" && step.tinyTool !== "artifact_check" && step.tinyTool !== "task_checkpoint")
    .concat(qwenStep, steps.filter((step) => step.tinyTool === "artifact_check" || step.tinyTool === "task_checkpoint"));
}

function coreSteps(objective: string, type: ArtifactType | undefined): ToolPlanStep[] {
  const qwen = needsQwenPolicy(objective);
  const mermaid = mermaidStep(type);
  const template = type ? artifactTemplateStep() : undefined;
  if (needsRepositoryAnalysisWorkflow(objective)) {
    return [
      { order: 1, goal: "create analysis workflow source of truth", tinyTool: "analysis_workflow_start", outputBudget: "task id, run id, stateRef, nextCommand" },
      { order: 2, goal: "preflight local provider metadata without chat generation", tinyTool: "provider_endpoint_preflight", outputBudget: "status, requestAttempted, diagnostics" },
      { order: 3, goal: "probe tool-call conformance from a fixture or loopback metadata-safe path", tinyTool: "tool_call_conformance_probe", outputBudget: "valid calls and diagnostics only" },
      { order: 4, goal: "simulate context budget before handing work to small models", tinyTool: "context_budget_simulation", outputBudget: "fit decision and split diagnostics" },
      { order: 5, goal: "get next bounded workflow packet", tinyTool: "workflow_next", outputBudget: "agent packet or blocked/done reason" },
      { order: 6, goal: "report progress heartbeat before waiting or finalizing", tinyTool: "workflow_progress_heartbeat", outputBudget: "statusLine, shouldContinue, sotRefs" },
      { order: 7, goal: "gate evidence before accepting model conclusions", tinyTool: "evidence_gate", outputBudget: "pass/fail and missing required checks" },
      { order: 8, goal: "audit final response against workflow source of truth", tinyTool: "workflow_sot_audit", outputBudget: "pass/fail and SOT diagnostics" },
    ];
  }
  if (needsSmallContextCorrection(objective)) {
    return [
      { order: 1, goal: "check canonical small-context readiness gate", tinyTool: "doctor", outputBudget: "status, smallContextRun, sections, and remediation only" },
      { order: 2, goal: "recover active task state when a task id exists", tinyTool: "session_preflight", outputBudget: "active task, latest checkpoint, and immediate risks only" },
      { order: 3, goal: "recover bounded context after compaction or interruption", tinyTool: "context_packet", outputBudget: "rules, notes, and evidence refs within maxContextChars" },
      { order: 4, goal: "invalidate stale source evidence by content hash", tinyTool: "incremental_evidence_cache", outputBudget: "cacheKey, staleReasons, recommendedRescanTools" },
      { order: 5, goal: "select the next capped correction sequence", tinyTool: "tool_usage_plan", outputBudget: "visible steps, omittedSteps, verification block" },
      { order: 6, goal: "shape Qwen packets locally without dispatch", tinyTool: "worker_packet_optimizer", outputBudget: "packets, dispatchMode, noLiveProviderCalls, ratePlan" },
      { order: 7, goal: "calculate Qwen retry and chunk limits without provider calls", tinyTool: "qwen_retry_policy", outputBudget: "limits, retryDelaysMs, recovery protocol" },
      { order: 8, goal: "checkpoint small-context correction state", tinyTool: "task_checkpoint", outputBudget: "summary, evidenceRefs, nextSteps, openQuestions" },
    ];
  }
  if (needsUxReverse(objective, type)) {
    return [
      { order: 1, goal: "catalog source-code-first screen layout elements", tinyTool: "ui_layout_catalog", outputBudget: "bounded UX elements with evidenceRefs" },
      { order: 2, goal: "derive conservative existence and position rationale", tinyTool: "ux_rationale_trace", outputBudget: "Verified/Inferred/Unknown rationale only" },
      { order: 3, goal: "split client/server validation and message evidence", tinyTool: "ux_validation_matrix", outputBudget: "bounded validation matrix" },
      { order: 4, goal: "verify existing layout truth before reuse", tinyTool: "layout_truth_verify", outputBudget: "verified/stale/missing counts and refs" },
      ...(template ? [template] : []),
      { order: 5, goal: "render UX reverse Markdown", tinyTool: "ux_reverse_report", outputBudget: "Markdown plus evidenceRefs" },
      { order: 6, goal: "validate UX reverse artifact contract", tinyTool: "artifact_check", outputBudget: "valid flag and diagnostics only" },
      { order: 7, goal: "update layout truth memory after validation", tinyTool: "layout_truth_update", outputBudget: "updated records and rejected list" },
      { order: 8, goal: "checkpoint continuation state", tinyTool: "task_checkpoint", outputBudget: "summary, nextSteps, evidenceRefs" },
    ];
  }
  if (needsLegacyTrace(objective)) return legacySteps(type, qwen);
  const generic: ToolPlanStep[] = [
    ...(template ? [template] : []),
    { order: 1, goal: "inventory candidate files", nativeTool: "fd", command: "fd --type f --hidden --exclude .git --exclude node_modules --exclude dist", outputBudget: "top 80 paths only" },
    { order: 2, goal: "build architecture and flow map", tinyTool: "repo_map", outputBudget: "bounded JSON summary" },
    { order: 3, goal: "extract business variables columns and comparisons", tinyTool: "business_logic_map", outputBudget: "bounded JSON evidence" },
    { order: 4, goal: "rank textual evidence", nativeTool: "ripgrep", command: "rg --json --line-number --column --no-heading '<term>' <paths>", outputBudget: "top 20 matches" },
    { order: 5, goal: "find syntax shapes", nativeTool: "ast-grep", command: "ast-grep run --lang ts -p '<pattern>' src", outputBudget: "top 20 structural matches" },
    { order: 6, goal: "extract cited source snippets", tinyTool: "context_digest", outputBudget: "max 12 snippets, 160 chars each" },
    { order: 7, goal: "check source edits before applying them", tinyTool: "safe_patch_check", outputBudget: "valid flag, touched paths, and diagnostics only" },
    ...(mermaid ? [mermaid] : []),
    ...(qwen ? [{ order: 8, goal: "calculate Qwen wait retry and chunking", tinyTool: "qwen_retry_policy", outputBudget: "limits, retryDelaysMs, recovery protocol" }] : []),
    { order: 9, goal: "validate final artifact contract", tinyTool: "artifact_check", outputBudget: "valid flag and diagnostics only" },
    { order: 10, goal: "write long output in chunks", tinyTool: "chunked_write_plan", outputBudget: "max 2000 chars per chunk" },
    { order: 11, goal: "checkpoint continuation state", tinyTool: "task_checkpoint", outputBudget: "summary, nextSteps, evidenceRefs, openQuestions" },
  ];
  if (!type) return generic;
  return generic.filter((step) => step.tinyTool !== "chunked_write_plan" && step.tinyTool !== "safe_patch_check" && step.nativeTool !== "ripgrep" && step.nativeTool !== "ast-grep");
}

function verificationTools(objective: string, type: ArtifactType | undefined): readonly string[] {
  if (needsRepositoryAnalysisWorkflow(objective)) return ["evidence_gate", "workflow_sot_audit", "task_checkpoint"];
  if (needsSmallContextCorrection(objective)) return ["claim_evidence_check", "artifact_pack_manifest", "task_checkpoint"];
  if (needsUxReverse(objective, type)) return ["layout_truth_verify", "artifact_check", "claim_evidence_check", "task_checkpoint"];
  if (needsLegacyTrace(objective)) return ["evidence_qa", "claim_evidence_check", "artifact_check", "task_checkpoint"];
  return type === "sequence_diagram" || type === "flowchart" || type === "erd"
    ? ["trace_diagram_render", "artifact_check", "mermaid_check", "task_checkpoint"]
    : ["artifact_check", "task_checkpoint"];
}

function agentKind(objective: string): AgentKind | undefined {
  if (/\bwireframe\b/i.test(objective)) return "wireframe_planner";
  if (/\bux|layout|screen\b/i.test(objective)) return "ui_ux_analyst";
  if (/\bfact|research|collect repo\b/i.test(objective)) return "fact_researcher";
  if (/\breview\b/i.test(objective)) return "reviewer";
  if (/\bqa|test\b/i.test(objective)) return "qa_runner";
  if (/\bimplement|fix|code\b/i.test(objective)) return "implementation_worker";
  return undefined;
}

export function createToolUsagePlan(input: Record<string, unknown>, runtimeMode: TinyChuRuntimeMode = "orchestrator_worker"): ToolUsagePlanResult {
  const objective = textInput(input.objective, "analyze repository with bounded evidence");
  const type = artifactType(input.artifactType);
  const ordered = coreSteps(objective, type)
    .map((step, index) => ({ ...step, order: index + 1 }));
  const requiredTools = verificationTools(objective, type);
  const recommendedAgentKind = agentKind(objective);
  const templates = createDefaultAgentModelTemplates();
  const template = recommendedAgentKind ? templates[recommendedAgentKind] : undefined;
  return applyToolPlanRuntimeMode({
    objective,
    ...(type ? { artifactType: type } : {}),
    modelBudget: { maxInputTokens: 1800, maxOutputTokens: 700, maxOpenFiles: 3 },
    steps: ordered.slice(0, MAX_VISIBLE_STEPS),
    omittedSteps: Math.max(0, ordered.length - MAX_VISIBLE_STEPS),
    nextRequiredTool: requiredTools[0],
    ...(recommendedAgentKind && template ? { agentKind: recommendedAgentKind, modelOptionValidation: validateAgentModelTemplate(template) } : {}),
    deterministicCaps: DETERMINISTIC_CAPS,
    reuseEvidence: [
      { tool: "evidence_snapshot", purpose: "reuse captured QA/build/tool evidence before rescanning source" },
      { tool: "incremental_evidence_cache", purpose: "detect stale source evidence before trusting older traces" },
    ],
    verification: {
      requiredAfterWork: true,
      requiredTools,
      requiredEvidence: ["tool output JSON", "artifact_check or evidence_qa result", "task_checkpoint id"],
    },
    stopRules: [
      ...repositoryAnalysisStopRules(needsRepositoryAnalysisWorkflow(objective)),
      ...smallContextCorrectionStopRules(needsSmallContextCorrection(objective)),
      ...BASE_STOP_RULES,
    ],
  }, runtimeMode);
}
