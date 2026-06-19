export type SmallModelContributionStatus = "pass" | "fail";
export type SmallModelContributionScoreBand = "material_help" | "infrastructure_help" | "weak_scaffold" | "decorative";
export type SmallModelContributionSeverity = "fail" | "warning";
export type SmallModelContributionLoadKind = "skill" | "command" | "tool" | "prompt" | "file_write" | "provider_call" | "context" | "recovery" | "evidence";

export interface SmallModelContributionFixPath {
  readonly tool: string;
  readonly nextCommand: string;
  readonly sourcePath?: string;
  readonly docPath?: string;
}

export interface SmallModelContributionRow {
  readonly id: string;
  readonly category: string;
  readonly title: string;
  readonly score: 0 | 1 | 2;
  readonly maxScore: 2;
  readonly required: boolean;
  readonly evidenceRefs: readonly string[];
}

export interface SmallModelContributionLoadFactor {
  readonly factorId: SmallModelContributionFactorId;
  readonly kind: SmallModelContributionLoadKind;
  readonly severity: SmallModelContributionSeverity;
  readonly measured: number;
  readonly threshold: number;
  readonly blockedReason: string;
  readonly fixPaths: readonly SmallModelContributionFixPath[];
}

export interface SmallModelContributionDiagnostic {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly rowId?: string;
  readonly factorId?: string;
}

export interface SmallModelContributionEvaluation {
  readonly status: SmallModelContributionStatus;
  readonly requestAttempted: false;
  readonly rows: readonly SmallModelContributionRow[];
  readonly rawScore: number;
  readonly maxScore: number;
  readonly normalizedScore: number;
  readonly scoreBand: SmallModelContributionScoreBand;
  readonly loadFactors: readonly SmallModelContributionLoadFactor[];
  readonly diagnostics: readonly SmallModelContributionDiagnostic[];
  readonly blockedReasons: readonly string[];
  readonly fixPaths: readonly SmallModelContributionFixPath[];
}

export interface SmallModelContributionInput {
  readonly rubricRows?: unknown;
  readonly loadObservations?: unknown;
  readonly contextBudget?: unknown;
  readonly toolUsagePlan?: unknown;
  readonly evidenceGate?: unknown;
  readonly resumePacket?: unknown;
  readonly qwenRetryPolicy?: unknown;
  readonly providerCall?: unknown;
}

const REQUIRED_ROW_IDS = [
  "A01", "A02", "A03", "A04", "B05", "B06", "B07", "B08", "C09", "C10", "C11", "C12", "D13", "D14", "D15", "E16", "E17", "E18", "F19", "F20", "F21", "F22",
] as const;
const REQUIRED_ROW_SET: ReadonlySet<string> = new Set(REQUIRED_ROW_IDS);

const FACTOR_KINDS = {
  skill_overload: "skill",
  command_output_overload: "command",
  tool_surface_overload: "tool",
  prompt_over_budget: "prompt",
  file_write_too_large: "file_write",
  provider_call_attempted: "provider_call",
  context_split_required: "context",
  missing_recovery_state: "recovery",
  missing_evidence_ref: "evidence",
  blocked_reason_missing: "recovery",
  resume_entry_missing: "recovery",
  retry_policy_missing: "recovery",
  stale_context: "context",
} as const satisfies Record<string, SmallModelContributionLoadKind>;

export type SmallModelContributionFactorId = keyof typeof FACTOR_KINDS;

const DEFAULT_FACTORS = {
  skill_overload: { severity: "warning", measured: 1, threshold: 0, blockedReason: "Loaded skills should be narrowed before small-model execution.", fixPaths: [{ tool: "tool_usage_plan", nextCommand: "load only the skill references needed for the next action" }] },
  command_output_overload: { severity: "warning", measured: 8001, threshold: 8000, blockedReason: "Command output exceeds the small-model readback budget.", fixPaths: [{ tool: "renderBudgetedOutput", nextCommand: "rerun command with a focused rg or sed range" }] },
  tool_surface_overload: { severity: "warning", measured: 41, threshold: 40, blockedReason: "The visible tool surface should be narrowed before action.", fixPaths: [{ tool: "tool_usage_plan", nextCommand: "select only the required Tiny-Chu tools for the next action" }] },
  prompt_over_budget: { severity: "fail", measured: 12001, threshold: 12000, blockedReason: "The prompt is too large for the small-model contribution harness.", fixPaths: [{ tool: "context_packet", nextCommand: "regenerate a bounded context packet with maxChars 6000" }] },
  file_write_too_large: { severity: "fail", measured: 2001, threshold: 2000, blockedReason: "The write chunk is too large for reliable local review.", fixPaths: [{ tool: "chunked_write_plan", nextCommand: "split the generated artifact into sub-2000 character chunks" }] },
  provider_call_attempted: { severity: "fail", measured: 1, threshold: 0, blockedReason: "A provider call was requested; this evaluator only accepts offline fixture evidence.", fixPaths: [{ tool: "provider_endpoint_preflight", nextCommand: "replace provider execution with an offline fixture transcript" }] },
  context_split_required: { severity: "fail", measured: 1, threshold: 0, blockedReason: "The context packet must be split before small-model execution.", fixPaths: [{ tool: "context_packet", nextCommand: "split the packet and rerun context_budget_simulation" }] },
  missing_evidence_ref: { severity: "fail", measured: 0, threshold: 1, blockedReason: "Required proof lacks an evidence reference.", fixPaths: [{ tool: "evidence_gate", nextCommand: "record the failing command output under .omo/evidence" }] },
  blocked_reason_missing: { severity: "fail", measured: 0, threshold: 1, blockedReason: "A blocked load factor must explain why work is blocked.", fixPaths: [{ tool: "small_model_contribution_evaluation", nextCommand: "add blockedReason to the load factor fixture" }] },
  resume_entry_missing: { severity: "fail", measured: 0, threshold: 1, blockedReason: "Resume entry is missing from the continuation packet.", fixPaths: [{ tool: "task_focus_packet", nextCommand: "rebuild the resume entry before continuing" }] },
  missing_recovery_state: { severity: "fail", measured: 0, threshold: 1, blockedReason: "The worker has no checkpoint or resume packet for continuation.", fixPaths: [{ tool: "task_checkpoint", nextCommand: "write a checkpoint before retrying the work" }] },
  retry_policy_missing: { severity: "fail", measured: 0, threshold: 1, blockedReason: "Retry recovery is missing a checkpoint policy.", fixPaths: [{ tool: "qwen_retry_policy", nextCommand: "calculate retry limits before another provider-facing attempt" }] },
  stale_context: { severity: "warning", measured: 1, threshold: 0, blockedReason: "Context evidence is stale and should be refreshed.", fixPaths: [{ tool: "incremental_evidence_cache", nextCommand: "refresh stale evidence before scoring contribution" }] },
} as const satisfies Record<SmallModelContributionFactorId, Omit<SmallModelContributionLoadFactor, "factorId" | "kind">>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function rowScore(value: unknown): 0 | 1 | 2 | undefined {
  return value === 0 || value === 1 || value === 2 ? value : undefined;
}

function factorId(value: unknown): SmallModelContributionFactorId | undefined {
  switch (value) {
    case "skill_overload":
    case "command_output_overload":
    case "tool_surface_overload":
    case "prompt_over_budget":
    case "file_write_too_large":
    case "provider_call_attempted":
    case "context_split_required":
    case "missing_recovery_state":
    case "missing_evidence_ref":
    case "blocked_reason_missing":
    case "resume_entry_missing":
    case "retry_policy_missing":
    case "stale_context":
      return value;
    default:
      return undefined;
  }
}

function fixPaths(value: unknown): readonly SmallModelContributionFixPath[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((item) => {
    const tool = nonEmptyText(item.tool);
    const nextCommand = nonEmptyText(item.nextCommand);
    if (!tool || !nextCommand) return [];
    const sourcePath = nonEmptyText(item.sourcePath);
    const docPath = nonEmptyText(item.docPath);
    return [{ tool, nextCommand, ...(sourcePath ? { sourcePath } : {}), ...(docPath ? { docPath } : {}) }];
  });
}

function parseRows(value: unknown, diagnostics: SmallModelContributionDiagnostic[]): readonly SmallModelContributionRow[] {
  const rows = Array.isArray(value) ? value.filter(isRecord) : [];
  const seen = new Set<string>();
  const parsed: SmallModelContributionRow[] = [];
  for (const item of rows) {
    const id = nonEmptyText(item.id);
    const score = rowScore(item.score);
    if (!id) continue;
    if (seen.has(id)) {
      diagnostics.push({ code: "duplicate_row_id", severity: "error", rowId: id, message: `Duplicate rubric row id: ${id}` });
      continue;
    }
    seen.add(id);
    if (score === undefined) diagnostics.push({ code: "invalid_row_score", severity: "error", rowId: id, message: `Rubric row ${id} must use score 0, 1, or 2.` });
    if (item.maxScore !== 2) diagnostics.push({ code: "invalid_row_max_score", severity: "error", rowId: id, message: `Rubric row ${id} must use maxScore 2.` });
    const isRequiredRow = REQUIRED_ROW_SET.has(id);
    const required = isRequiredRow || (booleanValue(item.required) ?? false);
    const evidenceRefs = stringList(item.evidenceRefs);
    if (required && evidenceRefs.length === 0) diagnostics.push({ code: "missing_evidence_ref", severity: "error", rowId: id, message: `Required rubric row ${id} has no evidenceRefs.` });
    if (score !== undefined && item.maxScore === 2 && isRequiredRow) {
      parsed.push({ id, category: nonEmptyText(item.category) ?? "", title: nonEmptyText(item.title) ?? "", score, maxScore: 2, required, evidenceRefs });
    }
  }
  const parsedIds = new Set(parsed.map((row) => row.id));
  const missing = REQUIRED_ROW_IDS.filter((id) => !parsedIds.has(id));
  if (missing.length > 0) diagnostics.push({ code: "missing_required_rows", severity: "error", message: `Missing required rubric rows: ${missing.join(", ")}` });
  return parsed.sort((left, right) => `${left.category}:${left.id}`.localeCompare(`${right.category}:${right.id}`));
}

function buildFactor(id: SmallModelContributionFactorId, input: Partial<Omit<SmallModelContributionLoadFactor, "factorId" | "kind">>): SmallModelContributionLoadFactor {
  const defaults = DEFAULT_FACTORS[id];
  return {
    factorId: id,
    kind: FACTOR_KINDS[id],
    severity: input.severity ?? defaults?.severity ?? "fail",
    measured: input.measured ?? defaults?.measured ?? 1,
    threshold: input.threshold ?? defaults?.threshold ?? 0,
    blockedReason: input.blockedReason ?? defaults?.blockedReason ?? "Small-model load factor requires remediation.",
    fixPaths: input.fixPaths && input.fixPaths.length > 0 ? input.fixPaths : defaults?.fixPaths ?? [{ tool: "tool_usage_plan", nextCommand: "narrow the next action and rerun the evaluator" }],
  };
}

function parseLoadObservations(value: unknown, diagnostics: SmallModelContributionDiagnostic[]): SmallModelContributionLoadFactor[] {
  const observations = Array.isArray(value) ? value.filter(isRecord) : [];
  const factors: SmallModelContributionLoadFactor[] = [];
  for (const item of observations) {
    const id = factorId(item.factorId);
    if (!id) {
      diagnostics.push({ code: "unknown_load_factor", severity: "error", factorId: nonEmptyText(item.factorId), message: "Unknown load factor id." });
      continue;
    }
    const reason = nonEmptyText(item.blockedReason);
    const paths = fixPaths(item.fixPaths);
    if (!reason) diagnostics.push({ code: "blocked_reason_missing", severity: "error", factorId: id, message: `Load factor ${id} has no blockedReason.` });
    if (paths.length === 0) diagnostics.push({ code: "fix_paths_missing", severity: "error", factorId: id, message: `Load factor ${id} has no fixPaths.` });
    if (id === "provider_call_attempted") diagnostics.push({ code: "provider_call_forbidden", severity: "error", factorId: id, message: "Provider calls are forbidden for offline contribution evaluation." });
    factors.push(buildFactor(id, { severity: item.severity === "warning" ? "warning" : "fail", measured: numberValue(item.measured), threshold: numberValue(item.threshold), ...(reason ? { blockedReason: reason } : {}), fixPaths: paths }));
  }
  return factors;
}

function addSynthesizedFactors(input: SmallModelContributionInput, factors: SmallModelContributionLoadFactor[], diagnostics: SmallModelContributionDiagnostic[]): void {
  const add = (id: SmallModelContributionFactorId, overrides: Partial<Omit<SmallModelContributionLoadFactor, "factorId" | "kind">> = {}) => {
    const next = buildFactor(id, overrides);
    const index = factors.findIndex((item) => item.factorId === id);
    if (index === -1) factors.push(next);
    else if (factors[index]?.severity === "warning" && next.severity === "fail") factors[index] = next;
  };
  if (isRecord(input.providerCall) && booleanValue(input.providerCall.requested) === true) add("provider_call_attempted");
  if (isRecord(input.contextBudget)) {
    const promptChars = numberValue(input.contextBudget.promptChars);
    if (promptChars !== undefined && promptChars > 12000) add("prompt_over_budget", { severity: "fail", measured: promptChars, threshold: 12000 });
    else if (promptChars !== undefined && promptChars > 6000) add("prompt_over_budget", { severity: "warning", measured: promptChars, threshold: 6000 });
    if (input.contextBudget.status === "split_required") add("context_split_required");
  }
  if (isRecord(input.toolUsagePlan)) {
    const visibleToolCount = numberValue(input.toolUsagePlan.visibleToolCount);
    const selectedPathLength = numberValue(input.toolUsagePlan.selectedPathLength);
    if (visibleToolCount !== undefined && visibleToolCount > 88) add("tool_surface_overload", { severity: "fail", measured: visibleToolCount, threshold: 88 });
    else if (visibleToolCount !== undefined && visibleToolCount > 40) add("tool_surface_overload", { severity: "warning", measured: visibleToolCount, threshold: 40 });
    if (selectedPathLength !== undefined && selectedPathLength > 8) add("tool_surface_overload", { severity: "warning", measured: selectedPathLength, threshold: 8 });
  }
  if (isRecord(input.evidenceGate) && (input.evidenceGate.status === "fail" || stringList(input.evidenceGate.evidenceRefs).length === 0 && Array.isArray(input.evidenceGate.missingRequired) && input.evidenceGate.missingRequired.length > 0)) add("missing_evidence_ref");
  if (isRecord(input.resumePacket) && (booleanValue(input.resumePacket.hasCheckpoint) === false || booleanValue(input.resumePacket.hasNextSteps) === false)) add("missing_recovery_state");
  if (isRecord(input.qwenRetryPolicy) && booleanValue(input.qwenRetryPolicy.checkpointBeforeRetry) === false) add("retry_policy_missing");
  if (factors.some((item) => item.factorId === "provider_call_attempted") && !diagnostics.some((item) => item.code === "provider_call_forbidden")) diagnostics.push({ code: "provider_call_forbidden", severity: "error", factorId: "provider_call_attempted", message: "Provider calls are forbidden for offline contribution evaluation." });
}

function scoreBand(score: number): SmallModelContributionScoreBand {
  if (score >= 82) return "material_help";
  if (score >= 55) return "infrastructure_help";
  if (score >= 28) return "weak_scaffold";
  return "decorative";
}

export function createSmallModelContributionEvaluation(input: SmallModelContributionInput): SmallModelContributionEvaluation {
  const diagnostics: SmallModelContributionDiagnostic[] = [];
  const rows = parseRows(input.rubricRows, diagnostics);
  const loadFactors = parseLoadObservations(input.loadObservations, diagnostics);
  addSynthesizedFactors(input, loadFactors, diagnostics);
  const sortedFactors = loadFactors.sort((left, right) => `${left.severity}:${left.factorId}`.localeCompare(`${right.severity}:${right.factorId}`));
  const rawScore = rows.reduce((sum, row) => sum + row.score, 0);
  const maxScore = REQUIRED_ROW_IDS.length * 2;
  const normalizedScore = maxScore === 0 ? 0 : Math.round(rawScore / maxScore * 100);
  const sortedDiagnostics = diagnostics.sort((left, right) => `${left.code}:${left.rowId ?? ""}:${left.factorId ?? ""}`.localeCompare(`${right.code}:${right.rowId ?? ""}:${right.factorId ?? ""}`));
  const blockedReasons = [...new Set(sortedFactors.map((item) => item.blockedReason).filter((reason) => reason.length > 0))].sort();
  const remediation = sortedFactors.flatMap((item) => item.fixPaths).sort((left, right) => `${left.tool}:${left.nextCommand}`.localeCompare(`${right.tool}:${right.nextCommand}`));
  const status = sortedDiagnostics.some((item) => item.severity === "error") || sortedFactors.some((item) => item.severity === "fail") ? "fail" : "pass";
  return { status, requestAttempted: false, rows, rawScore, maxScore, normalizedScore, scoreBand: scoreBand(normalizedScore), loadFactors: sortedFactors, diagnostics: sortedDiagnostics, blockedReasons, fixPaths: remediation };
}
