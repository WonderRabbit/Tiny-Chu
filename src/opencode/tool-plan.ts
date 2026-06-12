import type { ArtifactType } from "./artifact-contract.js";

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
  readonly stopRules: readonly string[];
}

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

function legacySteps(type: ArtifactType | undefined): ToolPlanStep[] {
  const mermaid = mermaidStep(type);
  return [
    { order: 1, goal: "inventory candidate files", nativeTool: "fd", command: "fd --type f --hidden --exclude .git --exclude node_modules --exclude dist", outputBudget: "top 80 paths only" },
    { order: 2, goal: "build deterministic legacy evidence index", tinyTool: "legacy_repo_index", outputBudget: "bounded JSON facts with file and line evidence" },
    { order: 3, goal: "trace UI event to Redux Saga and API client", tinyTool: "ui_action_trace", outputBudget: "one trace row with Unknown gaps" },
    { order: 4, goal: "trace API endpoint to backend service", tinyTool: "api_backend_trace", outputBudget: "route, service, mapper, RFC links only when verified" },
    { order: 5, goal: "catalog MyBatis and RFC integration evidence", tinyTool: "integration_catalog", outputBudget: "DB/RFC catalog summary" },
    { order: 6, goal: "merge verified links into traceability matrix", tinyTool: "traceability_matrix", outputBudget: "JSON rows plus Markdown table" },
    { order: 7, goal: "audit trace for hallucinated symbols and missing evidence", tinyTool: "evidence_qa", outputBudget: "blockers, warnings, required fixes" },
    ...(mermaid ? [mermaid] : []),
    { order: 9, goal: "checkpoint continuation state", tinyTool: "task_checkpoint", outputBudget: "summary, nextSteps, evidenceRefs, openQuestions" },
  ];
}

function coreSteps(objective: string, type: ArtifactType | undefined): ToolPlanStep[] {
  const qwen = needsQwenPolicy(objective);
  const mermaid = mermaidStep(type);
  if (needsLegacyTrace(objective) && !qwen) return legacySteps(type);
  return [
    { order: 1, goal: "inventory candidate files", nativeTool: "fd", command: "fd --type f --hidden --exclude .git --exclude node_modules --exclude dist", outputBudget: "top 80 paths only" },
    { order: 2, goal: "build architecture and flow map", tinyTool: "repo_map", outputBudget: "bounded JSON summary" },
    { order: 3, goal: "extract business variables columns and comparisons", tinyTool: "business_logic_map", outputBudget: "bounded JSON evidence" },
    { order: 4, goal: "rank textual evidence", nativeTool: "ripgrep", command: "rg --json --line-number --column --no-heading '<term>' <paths>", outputBudget: "top 20 matches" },
    { order: 5, goal: "find syntax shapes", nativeTool: "ast-grep", command: "ast-grep run --lang ts -p '<pattern>' src", outputBudget: "top 20 structural matches" },
    { order: 6, goal: "extract cited source snippets", tinyTool: "context_digest", outputBudget: "max 12 snippets, 160 chars each" },
    ...(mermaid ? [mermaid] : []),
    ...(qwen ? [{ order: 8, goal: "calculate Qwen wait retry and chunking", tinyTool: "qwen_retry_policy", outputBudget: "limits, retryDelaysMs, recovery protocol" }] : []),
    { order: 9, goal: "validate final artifact contract", tinyTool: "artifact_check", outputBudget: "valid flag and diagnostics only" },
    { order: 10, goal: "write long output in chunks", tinyTool: "chunked_write_plan", outputBudget: "max 2000 chars per chunk" },
    { order: 11, goal: "checkpoint continuation state", tinyTool: "task_checkpoint", outputBudget: "summary, nextSteps, evidenceRefs, openQuestions" },
  ];
}

export function createToolUsagePlan(input: Record<string, unknown>): ToolUsagePlanResult {
  const objective = textInput(input.objective, "analyze repository with bounded evidence");
  const type = artifactType(input.artifactType);
  const ordered = coreSteps(objective, type)
    .map((step, index) => ({ ...step, order: index + 1 }));
  return {
    objective,
    ...(type ? { artifactType: type } : {}),
    modelBudget: { maxInputTokens: 1800, maxOutputTokens: 700, maxOpenFiles: 3 },
    steps: ordered.slice(0, 8),
    stopRules: [
      "do not read full files when repo_map or context_digest can answer",
      "do not ask the model to infer variables columns or comparisons before business_logic_map",
      "do not abandon public Qwen failures; use qwen_retry_policy then public_retry",
      "run orchestration_health after retries, interruptions, or failed worker jobs",
      "do not produce artifact claims without evidenceRefs",
      "checkpoint before delegation, long commands, compaction, and final output",
    ],
  };
}
