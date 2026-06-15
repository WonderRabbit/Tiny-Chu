export const AGENT_KINDS = ["foreman", "delegate", "fact_researcher", "ui_ux_analyst", "wireframe_planner", "implementation_worker", "reviewer", "qa_runner"] as const;

export type AgentKind = (typeof AGENT_KINDS)[number];
export type ModelProvider = "ollama" | "opencode-agent" | "openai-responses" | "anthropic-messages";
export type DiagnosticAction = "accept" | "omit" | "reject";

export interface AgentModelTemplate {
  readonly agentKind: AgentKind;
  readonly modelRef: { readonly provider: ModelProvider; readonly model: string };
  readonly generation: {
    readonly sampling?: { readonly temperature?: number; readonly topP?: number; readonly topK?: number };
    readonly reasoning?: { readonly openaiEffort?: "low" | "medium" | "high"; readonly anthropicBudgetTokens?: number };
    readonly providerServiceTier?: "default" | "priority" | "batch";
    readonly providerToolChoice?: "auto" | "none" | "required";
  };
  readonly capabilities: readonly string[];
  readonly validationRules: readonly string[];
}

export interface AgentModelOptionDiagnostic {
  readonly code: string;
  readonly severity: "warning" | "error";
  readonly provider: ModelProvider;
  readonly model: string;
  readonly fieldPath: string;
  readonly action: DiagnosticAction;
  readonly message: string;
}

export interface AgentModelTemplateValidation {
  readonly valid: boolean;
  readonly diagnostics: readonly AgentModelOptionDiagnostic[];
}

export interface ModelOptionControlInput {
  readonly field: string;
  readonly kind: "boolean" | "number" | "enum" | "multi";
  readonly values?: readonly string[];
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly capability?: { readonly supported: boolean; readonly reason?: string };
}

export interface ModelOptionControlRecommendation {
  readonly field: string;
  readonly control: "select" | "segmented" | "checkbox" | "multiselect" | "number_input" | "slider" | "disabled" | "hidden";
  readonly options?: readonly string[];
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly diagnostic?: string;
}

const DEFAULT_RULES = ["no provider generation calls", "validate provider-specific options before dispatch"] as const;

function template(agentKind: AgentKind, provider: ModelProvider, model: string, capabilities: readonly string[], generation: AgentModelTemplate["generation"]): AgentModelTemplate {
  return { agentKind, modelRef: { provider, model }, generation, capabilities, validationRules: DEFAULT_RULES };
}

export function createDefaultAgentModelTemplates(): Record<AgentKind, AgentModelTemplate> {
  return {
    foreman: template("foreman", "ollama", "gemma4-small", ["planning", "checkpointing"], { sampling: { temperature: 0.1 }, providerToolChoice: "auto" }),
    delegate: template("delegate", "opencode-agent", "qwen3.6-35b-a3b", ["analysis", "artifact_draft"], { sampling: { temperature: 0.2 }, providerServiceTier: "priority", providerToolChoice: "auto" }),
    fact_researcher: template("fact_researcher", "opencode-agent", "qwen3.6-35b-a3b", ["fact_research"], { sampling: { temperature: 0 }, providerToolChoice: "auto" }),
    ui_ux_analyst: template("ui_ux_analyst", "opencode-agent", "qwen3.6-35b-a3b", ["ux_analysis"], { sampling: { temperature: 0.1 }, providerToolChoice: "auto" }),
    wireframe_planner: template("wireframe_planner", "opencode-agent", "qwen3.6-35b-a3b", ["wireframe_planning"], { sampling: { temperature: 0.1 }, providerToolChoice: "auto" }),
    implementation_worker: template("implementation_worker", "opencode-agent", "qwen3.6-35b-a3b", ["implementation"], { sampling: { temperature: 0.15 }, providerToolChoice: "auto" }),
    reviewer: template("reviewer", "opencode-agent", "qwen3.6-35b-a3b", ["review"], { sampling: { temperature: 0 }, providerToolChoice: "auto" }),
    qa_runner: template("qa_runner", "opencode-agent", "qwen3.6-35b-a3b", ["qa"], { sampling: { temperature: 0 }, providerToolChoice: "auto" }),
  };
}

function diagnostic(templateValue: AgentModelTemplate, fieldPath: string, action: DiagnosticAction, message: string): AgentModelOptionDiagnostic {
  return { code: "unsupported_model_option", severity: action === "reject" ? "error" : "warning", provider: templateValue.modelRef.provider, model: templateValue.modelRef.model, fieldPath, action, message };
}

export function validateAgentModelTemplate(templateValue: AgentModelTemplate): AgentModelTemplateValidation {
  const diagnostics: AgentModelOptionDiagnostic[] = [];
  const sampling = templateValue.generation.sampling;
  const reasoning = templateValue.generation.reasoning;
  if (templateValue.modelRef.provider === "openai-responses" && sampling?.topK !== undefined) {
    diagnostics.push(diagnostic(templateValue, "generation.sampling.topK", "reject", "OpenAI Responses templates do not support topK."));
  }
  if (templateValue.modelRef.provider === "anthropic-messages") {
    if (sampling?.temperature !== undefined && sampling.temperature !== 1) diagnostics.push(diagnostic(templateValue, "generation.sampling.temperature", "omit", "Anthropic Opus templates use default temperature."));
    if (sampling?.topP !== undefined && sampling.topP !== 1) diagnostics.push(diagnostic(templateValue, "generation.sampling.topP", "omit", "Anthropic Opus templates use default topP."));
    if (sampling?.topK !== undefined) diagnostics.push(diagnostic(templateValue, "generation.sampling.topK", "reject", "Anthropic Messages templates do not accept topK."));
    if (reasoning?.openaiEffort !== undefined) diagnostics.push(diagnostic(templateValue, "generation.reasoning.openaiEffort", "reject", "Anthropic reasoning must use provider-native fields."));
  }
  return { valid: !diagnostics.some((item) => item.severity === "error"), diagnostics };
}

export function recommendModelOptionControls(input: ModelOptionControlInput): ModelOptionControlRecommendation {
  if (input.capability && !input.capability.supported) {
    return { field: input.field, control: "disabled", diagnostic: input.capability.reason ?? "unsupported capability" };
  }
  switch (input.kind) {
    case "boolean":
      return { field: input.field, control: "checkbox" };
    case "multi":
      return { field: input.field, control: "multiselect", options: input.values ?? [] };
    case "enum":
      return { field: input.field, control: (input.values?.length ?? 0) <= 3 ? "segmented" : "select", options: input.values ?? [] };
    case "number":
      return { field: input.field, control: input.min !== undefined && input.max !== undefined ? "slider" : "number_input", min: input.min, max: input.max, step: input.step };
  }
}
