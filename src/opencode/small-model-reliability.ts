export type SmallModelGateStatus = "pass" | "warning" | "fail";

export interface SmallModelDiagnostic {
  readonly code: string;
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
}

export interface ToolCallConformanceResult {
  readonly status: SmallModelGateStatus;
  readonly requestAttempted: false;
  readonly toolCalls: readonly {
    readonly toolName: string;
    readonly valid: boolean;
    readonly argumentKeys: readonly string[];
  }[];
  readonly diagnostics: readonly SmallModelDiagnostic[];
}

export interface ContextBudgetSimulationResult {
  readonly status: "fit" | "split_required";
  readonly model: string;
  readonly maxContextTokens: number;
  readonly reservedOutputTokens: number;
  readonly usableInputTokens: number;
  readonly estimatedInputTokens: number;
  readonly tokenEstimateMode: "static_char_4";
  readonly packets: readonly {
    readonly name: string;
    readonly estimatedTokens: number;
  }[];
  readonly diagnostics: readonly SmallModelDiagnostic[];
}

export interface EvidenceGateResult {
  readonly status: SmallModelGateStatus;
  readonly missingRequired: readonly string[];
  readonly diagnostics: readonly SmallModelDiagnostic[];
}

export interface SmallModelReplayResult {
  readonly status: SmallModelGateStatus;
  readonly totalCases: number;
  readonly failedCases: number;
  readonly cases: readonly {
    readonly name: string;
    readonly passed: boolean;
    readonly diagnostics: readonly SmallModelDiagnostic[];
  }[];
  readonly diagnostics: readonly SmallModelDiagnostic[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map(String).filter((item) => item.trim() !== "") : [];
}

function strictStringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function evidenceRefs(value: Record<string, unknown>): readonly string[] {
  const singular = text(value.evidenceRef);
  return [...(singular ? [singular] : []), ...strictStringList(value.evidenceRefs)];
}

function extractToolCalls(value: unknown): readonly unknown[] {
  if (!isRecord(value)) return [];
  if (Array.isArray(value.tool_calls)) return value.tool_calls;
  if (Array.isArray(value.toolCalls)) return value.toolCalls;
  if (!Array.isArray(value.choices)) return [];
  const first = value.choices.find(isRecord);
  if (!first || !isRecord(first.message)) return [];
  if (Array.isArray(first.message.tool_calls)) return first.message.tool_calls;
  return [];
}

function parseToolCall(value: unknown, allowedTools: ReadonlySet<string>): ToolCallConformanceResult["toolCalls"][number] | undefined {
  if (!isRecord(value) || !isRecord(value.function)) return undefined;
  const toolName = text(value.function.name);
  const argumentsValue = value.function.arguments;
  if (typeof argumentsValue !== "string") return { toolName, valid: false, argumentKeys: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsValue);
  } catch {
    return { toolName, valid: false, argumentKeys: [] };
  }
  const argumentKeys = isRecord(parsed) ? Object.keys(parsed).sort() : [];
  return { toolName, valid: toolName !== "" && allowedTools.has(toolName) && isRecord(parsed), argumentKeys };
}

export function createToolCallConformanceProbe(input: Record<string, unknown>): ToolCallConformanceResult {
  const allowedTools = new Set(stringList(input.allowedTools));
  const calls = extractToolCalls(input.fixture).map((item) => parseToolCall(item, allowedTools)).filter((item) => item !== undefined);
  const diagnostics: SmallModelDiagnostic[] = [];
  if (calls.length === 0) diagnostics.push({ code: "missing_tool_calls", severity: "error", message: "Fixture does not contain structured tool_calls." });
  for (const call of calls) {
    if (!call.valid) diagnostics.push({ code: "invalid_tool_arguments", severity: "error", message: `Tool call ${call.toolName || "<missing>"} is not allowed or has invalid JSON object arguments.` });
  }
  return { status: diagnostics.some((item) => item.severity === "error") ? "fail" : "pass", requestAttempted: false, toolCalls: calls, diagnostics };
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

export function createContextBudgetSimulation(input: Record<string, unknown>): ContextBudgetSimulationResult {
  const model = text(input.model, "small-local-model");
  const maxContextTokens = positiveInteger(input.maxContextTokens, 8192);
  const reservedOutputTokens = positiveInteger(input.reservedOutputTokens, 1024);
  const usableInputTokens = Math.max(1, maxContextTokens - reservedOutputTokens);
  const packetInputs = Array.isArray(input.packets) ? input.packets : [];
  const packets = packetInputs.map((packet, index) => {
    const record = isRecord(packet) ? packet : {};
    return { name: text(record.name, `packet-${index + 1}`), estimatedTokens: positiveInteger(record.estimatedTokens, estimateTokens(text(record.text))) };
  });
  const estimatedInputTokens = packets.reduce((sum, packet) => sum + packet.estimatedTokens, 0);
  const fits = estimatedInputTokens <= usableInputTokens;
  return {
    status: fits ? "fit" : "split_required",
    model,
    maxContextTokens,
    reservedOutputTokens,
    usableInputTokens,
    estimatedInputTokens,
    tokenEstimateMode: "static_char_4",
    packets,
    diagnostics: [{ code: fits ? "context_budget_fit" : "context_budget_exceeded", severity: fits ? "info" : "warning", message: fits ? "Estimated packet content fits the usable input budget." : "Estimated packet content should be split before worker execution." }],
  };
}

export function createEvidenceGate(input: Record<string, unknown>): EvidenceGateResult {
  const required = stringList(input.required);
  const requiredSet = new Set(required);
  const checks = Array.isArray(input.checks) ? input.checks.filter(isRecord) : [];
  const seen = new Set(checks.map((check) => text(check.name)).filter((name) => name !== ""));
  const missingRequired = required.filter((name) => !seen.has(name));
  const diagnostics: SmallModelDiagnostic[] = missingRequired.map((name) => ({ code: "required_check_missing", severity: "error", message: `Missing required evidence check: ${name}` }));
  for (const check of checks) {
    const name = text(check.name);
    const status = text(check.status);
    const isRequired = requiredSet.has(name);
    if (isRequired && status !== "pass") diagnostics.push({ code: "required_check_status_missing", severity: "error", message: text(check.summary, `Required evidence check must explicitly pass: ${name}`) });
    if (isRequired && evidenceRefs(check).length === 0) diagnostics.push({ code: "required_check_evidence_missing", severity: "error", message: `Required evidence check has no evidenceRef or evidenceRefs: ${name}` });
    if (status === "fail") diagnostics.push({ code: "required_check_failed", severity: "error", message: text(check.summary, `Evidence check failed: ${name}`) });
    if (status === "warning") diagnostics.push({ code: "check_warning", severity: isRequired ? "error" : "warning", message: text(check.summary, `Evidence check needs attention: ${name}`) });
  }
  return { status: diagnostics.some((item) => item.severity === "error") ? "fail" : diagnostics.length > 0 ? "warning" : "pass", missingRequired, diagnostics };
}

export function createSmallModelReplay(input: Record<string, unknown>): SmallModelReplayResult {
  const cases = (Array.isArray(input.cases) ? input.cases : []).filter(isRecord).map((item, index) => {
    const expected = text(item.expected);
    const actual = text(item.actual);
    const evidenceRefs = strictStringList(item.evidenceRefs);
    const diagnostics: SmallModelDiagnostic[] = [];
    if (expected !== actual) diagnostics.push({ code: "output_mismatch", severity: "error", message: "Replay output did not match the expected deterministic answer." });
    if (evidenceRefs.length === 0) diagnostics.push({ code: "missing_evidence_ref", severity: "error", message: "Replay case has no evidence reference." });
    return { name: text(item.name, `case-${index + 1}`), passed: diagnostics.length === 0, diagnostics };
  });
  const failedCases = cases.filter((item) => !item.passed).length;
  const diagnostics: SmallModelDiagnostic[] = cases.length === 0 ? [{ code: "missing_replay_cases", severity: "error", message: "At least one replay case is required." }] : [];
  return { status: failedCases === 0 && diagnostics.length === 0 ? "pass" : "fail", totalCases: cases.length, failedCases, cases, diagnostics };
}
