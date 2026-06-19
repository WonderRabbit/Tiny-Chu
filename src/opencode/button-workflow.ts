import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PublicDispatcher, type PublicJob } from "../dispatcher/public-job.js";
import { writeTextAtomic } from "../state/file-store.js";
import { resolveExistingPathInsideRoot, resolvePathInsideRoot } from "../state/path-safety.js";
import { readLegacySourceFiles } from "./legacy-scanner.js";
import { rejectRejectedPlanReviewGate } from "./plan-review-gate.js";

export { aggregationDriftCheck } from "./button-drift.js";

export interface ButtonWorkItem {
  readonly buttonId: string;
  readonly file: string;
  readonly line: number;
  readonly label: string;
  readonly handler: string;
  readonly component?: string;
  readonly evidenceRefs: readonly string[];
  readonly status?: "planned" | "dispatched" | "done";
  readonly unknowns?: readonly string[];
}

export interface ButtonWorkflowPlan {
  readonly workItems: readonly ButtonWorkItem[];
  readonly diagnostics: readonly string[];
}

export interface MarkdownEnvelopeCheckResult {
  readonly valid: boolean;
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
}

export interface ButtonWorkerResultCheckResult {
  readonly valid: boolean;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly completionReady: boolean;
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.flatMap((item) => typeof item === "string" ? [item] : []) : [];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined;
}

function buttonWorkItem(value: unknown): ButtonWorkItem | undefined {
  const item = record(value);
  if (!item || typeof item.buttonId !== "string" || typeof item.file !== "string" || typeof item.line !== "number" || typeof item.label !== "string" || typeof item.handler !== "string") return undefined;
  return { buttonId: item.buttonId, file: item.file, line: item.line, label: item.label, handler: item.handler, evidenceRefs: strings(item.evidenceRefs), status: item.status === "dispatched" || item.status === "done" ? item.status : "planned", unknowns: strings(item.unknowns) };
}

function records(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? value.flatMap((item) => {
    const row = record(item);
    return row ? [row] : [];
  }) : [];
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function checksum(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

export async function createButtonWorkflowPlan(root: string, input: Record<string, unknown>): Promise<ButtonWorkflowPlan> {
  const sources = await readLegacySourceFiles(root, { targetPath: input.targetPath ?? ".", maxFiles: 80 });
  const maxButtons = typeof input.maxButtons === "number" && Number.isInteger(input.maxButtons) && input.maxButtons > 0 ? input.maxButtons : 50;
  const workItems: ButtonWorkItem[] = [];
  for (const source of sources) {
    const lines = source.content.split(/\r?\n/);
    lines.forEach((line, index) => {
      const matches = line.matchAll(/<button[^>]*onClick=\{([^}]+)\}[^>]*>([^<]+)<\/button>/g);
      for (const match of matches) {
        const handler = match[1]?.trim() ?? "Unknown";
        const label = match[2]?.trim() ?? "Unknown";
        const lineNumber = index + 1;
        const buttonId = hash(`${source.path}:${lineNumber}:${handler}:${label}`);
        workItems.push({ buttonId, file: source.path, line: lineNumber, label, handler, evidenceRefs: [`${source.path}:${lineNumber}`], status: "planned", unknowns: handler === "Unknown" ? ["handler"] : [] });
      }
    });
  }
  const ids = new Set<string>();
  const diagnostics: string[] = [];
  for (const item of workItems) {
    if (ids.has(item.buttonId)) diagnostics.push(`Duplicate button id: ${item.buttonId}`);
    ids.add(item.buttonId);
  }
  return { workItems: workItems.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line).slice(0, maxButtons), diagnostics };
}

export function markdownEnvelopeCheck(input: Record<string, unknown>): MarkdownEnvelopeCheckResult {
  const value = record(input.value) ?? input;
  const diagnostics: { code: string; message: string }[] = [];
  for (const [key, field] of Object.entries(value)) {
    if (typeof field === "string" && /```|^#\s|\n##\s/m.test(field)) diagnostics.push({ code: key === "markdown" ? "markdown_field" : "markdown_in_json", message: `${key} contains Markdown in a JSON-only payload.` });
    if (typeof field === "string" && field.length > 8000) diagnostics.push({ code: "oversized_field", message: `${key} exceeds JSON worker field budget.` });
  }
  return { valid: diagnostics.length === 0, diagnostics };
}

function evidenceSet(index: Record<string, unknown> | undefined): ReadonlySet<string> {
  const facts = Array.isArray(index?.facts) ? index.facts : [];
  return new Set(facts.flatMap((fact) => {
    const row = record(fact);
    if (!row) return [];
    const id = typeof row.id === "string" ? [row.id] : [];
    const ref = typeof row.file === "string" && typeof row.line === "number" ? [`${row.file}:${row.line}`] : [];
    return [...id, ...ref];
  }));
}

export function buttonWorkerResultCheck(input: Record<string, unknown>): ButtonWorkerResultCheckResult {
  const result = record(input.result) ?? {};
  const expectedButtonId = typeof input.expectedButtonId === "string" ? input.expectedButtonId : undefined;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const buttonId = typeof result.buttonId === "string" ? result.buttonId : "";
  if (!buttonId) blockers.push("missing buttonId");
  if (expectedButtonId && buttonId !== expectedButtonId) blockers.push(`buttonId mismatch: expected ${expectedButtonId}, got ${buttonId}`);
  if (!["Verified", "Inferred", "Unknown"].includes(typeof result.status === "string" ? result.status : "")) blockers.push("unsupported status");
  const refs = strings(result.evidenceRefs);
  if (refs.length === 0) blockers.push("missing evidenceRefs");
  if (new Set(refs).size !== refs.length) blockers.push("duplicate evidenceRefs");
  const known = evidenceSet(record(input.evidenceIndex));
  if (known.size > 0) {
    for (const ref of refs) if (!known.has(ref)) blockers.push(`missing evidence: ${ref}`);
  } else {
    for (const ref of refs) if (ref.startsWith("missing")) blockers.push(`missing evidence: ${ref}`);
  }
  const envelope = markdownEnvelopeCheck({ value: result });
  blockers.push(...envelope.diagnostics.map((item) => item.message));
  return { valid: blockers.length === 0, blockers, warnings, completionReady: blockers.length === 0 };
}

export function createButtonWorkerPacket(input: Record<string, unknown>): Record<string, unknown> {
  const item = record(input.workItem);
  if (!item || typeof item.buttonId !== "string") throw new Error("button_worker_packet requires one workItem");
  const mustReturn = strings(input.mustReturn).length > 0 ? strings(input.mustReturn) : ["buttonId", "status", "traceRows", "evidenceRefs", "unknowns", "verificationCommands"];
  return {
    buttonIds: [item.buttonId],
    prompt: `Analyze exactly one button: ${item.buttonId}`,
    workItem: item,
    contract: { format: "json", mustReturn },
    budget: { inputTokensMax: 2400, outputTokensMax: 1200, totalTokensHard: 4000 },
  };
}

export async function dispatchButtonWorkflow(root: string, input: Record<string, unknown>): Promise<{ readonly dispatched: readonly PublicJob[]; readonly remaining: readonly ButtonWorkItem[] }> {
  const gateInput = input.planReviewGate === undefined ? input.plan : { ...record(input.plan), ...record(input.planReviewGate) };
  await rejectRejectedPlanReviewGate(gateInput, root);
  const plan = record(input.plan);
  const workItems = Array.isArray(plan?.workItems) ? plan.workItems.flatMap((item) => {
    const parsed = buttonWorkItem(item);
    return parsed ? [parsed] : [];
  }) : [];
  const maxParallel = typeof input.maxParallel === "number" ? input.maxParallel : 1;
  if (maxParallel < 1 || maxParallel > 2) throw new Error("maxParallel must be 1 or 2");
  const dispatcher = new PublicDispatcher({ root });
  const dispatched: PublicJob[] = [];
  for (const item of workItems.slice(0, maxParallel)) {
    const packet = createButtonWorkerPacket({ workItem: item });
    dispatched.push(await dispatcher.dispatch({ taskId: typeof input.taskId === "string" ? input.taskId : undefined, prompt: String(packet.prompt), mustReturn: [...strings(record(packet.contract)?.mustReturn)], budget: { inputTokensMax: 2400, outputTokensMax: 1200, totalTokensHard: 4000 }, format: "json" }));
  }
  return { dispatched, remaining: workItems.slice(maxParallel) };
}

export function aggregateButtonTraces(input: Record<string, unknown>): Record<string, unknown> {
  const results = records(input.results);
  const rows = results.flatMap((item) => Array.isArray(item.traceRows) ? item.traceRows : []);
  const evidenceRefs = [...new Set(results.flatMap((item) => strings(item.evidenceRefs)))].sort();
  return { rows, evidenceRefs, gaps: results.flatMap((item) => strings(item.unknowns)), confidenceSummary: { total: results.length, verified: results.filter((item) => item.status === "Verified").length } };
}

export async function atomicMarkdownWrite(root: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const relative = typeof input.path === "string" ? input.path : "";
  const absolute = resolvePathInsideRoot(root, relative);
  if (!absolute) throw new Error(`Markdown write path is outside configured root: ${relative}`);
  const markdown = typeof input.markdown === "string" ? input.markdown : "";
  await writeTextAtomic(absolute, markdown);
  return { path: relative, decision: "allow", checksum: checksum(markdown), bytes: markdown.length };
}

export async function writeLoopGuard(root: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const relative = typeof input.path === "string" ? input.path : "";
  const absolute = await resolveExistingPathInsideRoot(root, relative).catch(() => undefined);
  const markdown = typeof input.markdown === "string" ? input.markdown : "";
  const current = absolute ? await readFile(absolute, "utf8").catch(() => "") : "";
  const currentChecksum = checksum(current);
  const nextChecksum = checksum(markdown);
  const attempt = typeof input.attempt === "number" ? input.attempt : 1;
  if (markdown.length === 0 && current.length > 0) return { path: relative, decision: "block_empty_overwrite", currentChecksum, nextChecksum };
  if (input.previousChecksum === nextChecksum || currentChecksum === nextChecksum) return { path: relative, decision: "skip_identical", currentChecksum, nextChecksum };
  if (attempt > 3) return { path: relative, decision: "block_attempt_limit", currentChecksum, nextChecksum };
  return { path: relative, decision: "allow", currentChecksum, nextChecksum, sizeDelta: markdown.length - current.length };
}

export function buttonWorkflowDoneClaim(input: Record<string, unknown>): Record<string, unknown> {
  const planned = new Set(strings(input.plannedButtonIds));
  const jobs = records(input.jobs);
  const validation = records(input.validation);
  const drift = record(input.drift);
  const artifacts = records(input.artifacts);
  const blockers: string[] = [];
  if (planned.size === 0) blockers.push("missing planned buttons");
  if (jobs.length === 0) blockers.push("missing jobs");
  if (validation.length === 0) blockers.push("missing validations");
  if (artifacts.length === 0) blockers.push("missing artifacts");
  for (const id of planned) {
    if (!jobs.some((job) => job.buttonId === id && job.status === "done")) blockers.push(`missing done job: ${id}`);
    if (!validation.some((item) => item.buttonId === id && item.valid === true)) blockers.push(`missing valid result: ${id}`);
  }
  if (drift && Array.isArray(drift.blockers) && drift.blockers.length > 0) blockers.push("drift blockers remain");
  if (!artifacts.every((artifact) => artifact.valid === true)) blockers.push("artifact validation failed");
  if (!artifacts.some((artifact) => artifact.type === "claim" && artifact.valid === true)) blockers.push("missing claim check");
  if (!artifacts.some((artifact) => artifact.type === "mermaid" && artifact.valid === true)) blockers.push("missing mermaid check");
  if (!nonEmptyString(input.npmTestEvidence)) blockers.push("missing npm test evidence");
  if (!nonEmptyString(input.checkpointEvidence)) blockers.push("missing checkpoint evidence");
  return { valid: blockers.length === 0, blockers };
}
