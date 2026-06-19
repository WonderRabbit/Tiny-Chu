import { readFile } from "node:fs/promises";
import { resolveExistingPathInsideRoot } from "../state/path-safety.js";
import { parsePlanMarkdown } from "../ulw-loop/plan.js";

export type PlanReviewGateFindingCode =
  | "invalid_plan_ref"
  | "missing_objective"
  | "objective_too_short"
  | "missing_scope"
  | "missing_todos_or_nodes"
  | "missing_evidence_requirements"
  | "missing_qa_commands"
  | "missing_stop_conditions"
  | "missing_source_of_truth_refs";

export type PlanReviewGateSeverity = "error";

export type PlanReviewGateToolCall = {
  readonly tool: string;
  readonly input: Record<string, unknown>;
};

export type PlanReviewGateFinding = {
  readonly code: PlanReviewGateFindingCode;
  readonly severity: PlanReviewGateSeverity;
  readonly message: string;
  readonly remediationToolCalls: readonly PlanReviewGateToolCall[];
};

export type PlanReviewGateResult = {
  readonly accepted: boolean;
  readonly findings: readonly PlanReviewGateFinding[];
  readonly remediationToolCalls: readonly PlanReviewGateToolCall[];
};

const MIN_OBJECTIVE_LENGTH = 3;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function textArray(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.flatMap((item) => {
    const parsed = text(item);
    return parsed ? [parsed] : [];
  });
  const parsed = text(value);
  return parsed ? [parsed] : [];
}

function texts(input: Record<string, unknown>, keys: readonly string[]): readonly string[] {
  for (const key of keys) {
    const values = textArray(input[key]);
    if (values.length > 0) return values;
  }
  return [];
}

function plannedItems(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = text(item);
    if (parsed) return [parsed];
    const row = record(item);
    const label = text(row.id) ?? text(row.nodeId) ?? text(row.buttonId) ?? text(row.title) ?? text(row.text) ?? text(row.goal) ?? text(row.label);
    return label ? [label] : [];
  });
}

function remediation(code: PlanReviewGateFindingCode, objective: string | undefined): readonly PlanReviewGateToolCall[] {
  const planObjective = objective ?? "complete the plan artifact";
  switch (code) {
    case "invalid_plan_ref":
      return [{ tool: "context_bundle", input: { targetPath: "." } }];
    case "missing_objective":
    case "objective_too_short":
    case "missing_scope":
    case "missing_todos_or_nodes":
    case "missing_stop_conditions":
      return [{ tool: "tool_usage_plan", input: { objective: planObjective } }];
    case "missing_evidence_requirements":
      return [{ tool: "evidence_gate", input: { required: ["build", "test"], checks: [] } }];
    case "missing_qa_commands":
      return [{ tool: "run_diagnostics", input: { commands: ["npm run build", "npm test"] } }];
    case "missing_source_of_truth_refs":
      return [{ tool: "context_bundle", input: { targetPath: "." } }];
  }
}

function invalidPlanRefResult(planRef: string | undefined): PlanReviewGateResult {
  const message = planRef
    ? `Plan artifact reference is missing, unreadable, or outside the configured root: ${planRef}.`
    : "Plan artifact reference must be a non-empty relative path inside the configured root.";
  const findings = [finding("invalid_plan_ref", message, undefined)];
  return { accepted: false, findings, remediationToolCalls: uniqueToolCalls(findings) };
}

function markdownSections(content: string): ReadonlyMap<string, readonly string[]> {
  const sections = new Map<string, string[]>();
  let current = "";
  for (const line of content.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = heading[1].trim().toLowerCase();
      sections.set(current, []);
      continue;
    }
    if (current) sections.get(current)?.push(line);
  }
  return sections;
}

function firstSection(sections: ReadonlyMap<string, readonly string[]>, names: readonly string[]): string | undefined {
  for (const name of names) {
    const lines = sections.get(name);
    const value = lines?.join("\n").trim();
    if (value) return value;
  }
  return undefined;
}

function listItems(value: string | undefined): readonly string[] {
  if (!value) return [];
  return value.split(/\r?\n/).flatMap((line) => {
    const item = /^[-*]\s+(?:\[[ xX]\]\s*)?(.+?)\s*$/.exec(line.trim());
    return item ? [item[1].trim()] : [];
  });
}

function commandLikeLines(content: string): readonly string[] {
  const matches = content.match(/`([^`]*(?:npm|node|git|pnpm|bun)[^`]*)`/g) ?? [];
  return matches.map((match) => match.slice(1, -1).trim()).filter((match) => match !== "");
}

function sourceRefLines(content: string): readonly string[] {
  const matches = content.match(/[A-Za-z0-9_./-]+\.(?:md|json|ts|mjs)(?::\d+)?/g) ?? [];
  return [...new Set(matches)];
}

function parseMarkdownPlanArtifact(content: string, planRef: string): Record<string, unknown> {
  const sections = markdownSections(content);
  const status = parsePlanMarkdown(content, planRef);
  return {
    objective: firstSection(sections, ["goal"]) ?? /^#\s+(.+?)\s*$/m.exec(content)?.[1],
    scopePaths: listItems(firstSection(sections, ["scope", "must have"])),
    todos: status.checkboxes.map((item) => item.text),
    evidenceRequirements: [
      ...listItems(firstSection(sections, ["evidence", "verification strategy"])),
      ...sourceRefLines(content).filter((ref) => ref.startsWith(".omo/evidence/")),
    ],
    qaCommands: [
      ...listItems(firstSection(sections, ["verification", "verification strategy", "final verification wave"])),
      ...commandLikeLines(content),
    ],
    stopConditions: listItems(firstSection(sections, ["stop conditions", "success criteria", "must not have (guardrails, anti-slop, scope boundaries)"])),
    sourceOfTruthRefs: sourceRefLines(content).filter((ref) => ref.endsWith("AGENTS.md") || ref.includes(".omo/plans/") || ref.includes("src/") || ref.includes("test/")),
  };
}

function parsePlanArtifact(content: string, planRef: string): Record<string, unknown> | undefined {
  if (planRef.endsWith(".md")) return parseMarkdownPlanArtifact(content, planRef);
  try {
    const value: unknown = JSON.parse(content);
    return record(value);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function finding(code: PlanReviewGateFindingCode, message: string, objective: string | undefined): PlanReviewGateFinding {
  return { code, severity: "error", message, remediationToolCalls: remediation(code, objective) };
}

function uniqueToolCalls(findings: readonly PlanReviewGateFinding[]): readonly PlanReviewGateToolCall[] {
  const seen = new Set<string>();
  const calls: PlanReviewGateToolCall[] = [];
  for (const item of findings) {
    for (const call of item.remediationToolCalls) {
      const key = `${call.tool}:${JSON.stringify(call.input)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      calls.push(call);
    }
  }
  return calls;
}

export function createPlanReviewGate(value: Record<string, unknown>): PlanReviewGateResult {
  const input = record(value);
  const objective = text(input.objective);
  const findings: PlanReviewGateFinding[] = [];
  if (!objective) findings.push(finding("missing_objective", "Plan artifact must include a non-empty objective.", objective));
  if (objective && objective.length < MIN_OBJECTIVE_LENGTH) findings.push(finding("objective_too_short", "Objective is too short to guide deterministic dispatch.", objective));
  if (texts(input, ["scopePaths", "scope", "targetPath"]).length === 0) findings.push(finding("missing_scope", "Plan artifact must define scope paths or target scope.", objective));
  if (plannedItems(input.todos).length === 0 && plannedItems(input.nodes).length === 0 && plannedItems(input.workItems).length === 0) findings.push(finding("missing_todos_or_nodes", "Plan artifact must include todos or workflow nodes.", objective));
  if (texts(input, ["evidenceRequirements", "evidenceRefs", "evidence"]).length === 0) findings.push(finding("missing_evidence_requirements", "Plan artifact must list required evidence outputs.", objective));
  if (texts(input, ["qaCommands", "verificationCommands", "verification"]).length === 0) findings.push(finding("missing_qa_commands", "Plan artifact must list QA commands.", objective));
  if (texts(input, ["stopConditions", "stopCondition"]).length === 0) findings.push(finding("missing_stop_conditions", "Plan artifact must list stop conditions.", objective));
  if (texts(input, ["sourceOfTruthRefs", "sotRefs", "sourceRefs"]).length === 0) findings.push(finding("missing_source_of_truth_refs", "Plan artifact must list source-of-truth references.", objective));
  return { accepted: findings.length === 0, findings, remediationToolCalls: uniqueToolCalls(findings) };
}

export async function createPlanReviewGateFromInput(value: Record<string, unknown>, root: string | undefined): Promise<PlanReviewGateResult> {
  const input = record(value);
  const planRef = text(input.planRef);
  if (!planRef) return createPlanReviewGate(input);
  if (!root) return invalidPlanRefResult(planRef);
  const absolute = await resolveExistingPathInsideRoot(root, planRef);
  if (!absolute) return invalidPlanRefResult(planRef);
  try {
    const artifact = parsePlanArtifact(await readFile(absolute, "utf8"), planRef);
    if (!artifact) return invalidPlanRefResult(planRef);
    return createPlanReviewGate({ ...artifact, ...input });
  } catch (error) {
    if (error instanceof Error) return invalidPlanRefResult(planRef);
    throw error;
  }
}

export async function rejectRejectedPlanReviewGate(value: unknown, root?: string): Promise<void> {
  if (value === undefined) return;
  const result = await createPlanReviewGateFromInput(record(value), root);
  if (!result.accepted) throw new Error(`plan_review_gate rejected: ${result.findings.map((item) => item.code).join(", ")}`);
}
