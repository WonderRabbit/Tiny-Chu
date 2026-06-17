import { readdir } from "node:fs/promises";
import path from "node:path";
import { portableRelative, resolveExistingPathInsideRoot } from "../state/path-safety.js";
import { bounded, extensionPositiveInteger, extensionTextInput, scanFacts, type EvidenceStatus, type ScanFact } from "./extension-scan.js";

export interface FlowItem {
  readonly symbol: string;
  readonly file: string;
  readonly line: number;
  readonly status: EvidenceStatus;
}

export interface ReduxStateFlowMapResult {
  readonly slices: readonly FlowItem[];
  readonly reducers: readonly FlowItem[];
  readonly selectors: readonly FlowItem[];
  readonly reads: readonly FlowItem[];
  readonly writes: readonly FlowItem[];
  readonly links: readonly { readonly from: string; readonly to: string; readonly status: EvidenceStatus; readonly evidenceRefs: readonly string[] }[];
  readonly omittedLinks: number;
}

export interface AuthPermissionTraceResult {
  readonly conditions: readonly { readonly layer: string; readonly kind: string; readonly expression: string; readonly evidenceRef: string; readonly status: EvidenceStatus }[];
  readonly links: readonly { readonly from: string; readonly to: string; readonly status: EvidenceStatus; readonly evidenceRefs: readonly string[] }[];
  readonly omittedLinks: number;
  readonly unknowns: readonly string[];
  readonly risks: readonly string[];
}

export interface ErrorTransactionMapResult {
  readonly errorHandlers: readonly { readonly kind: string; readonly evidenceRef: string; readonly status: EvidenceStatus }[];
  readonly transactionBoundaries: readonly { readonly kind: string; readonly evidenceRef: string; readonly status: EvidenceStatus }[];
  readonly rollbackOrCompensation: readonly string[];
  readonly userMessages: readonly string[];
  readonly risks: readonly string[];
  readonly recommendedTests: readonly string[];
}

export interface TestImpactPlannerResult {
  readonly changeSummary: string;
  readonly impactedAreas: readonly string[];
  readonly existingTestCandidates: readonly { readonly path: string; readonly evidenceRef: string }[];
  readonly missingTestCases: readonly string[];
  readonly verificationCommands: readonly string[];
  readonly unknowns: readonly string[];
}

function item(fact: ScanFact): FlowItem {
  return { symbol: fact.symbol, file: fact.file, line: fact.line, status: fact.status };
}

function refOf(fact: ScanFact): string {
  return `${fact.file}:${fact.line}`;
}

function maxPairSide(maxLinks: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(maxLinks)));
}

export async function createReduxStateFlowMap(root: string, input: Record<string, unknown>): Promise<ReduxStateFlowMapResult> {
  const facts = await scanFacts(root, input, 80);
  const maxLinks = extensionPositiveInteger(input.maxLinks, 160);
  const selectors = bounded(facts.filter((fact) => fact.kind === "selector").map(item), input.maxItems, 80);
  const reducers = bounded(facts.filter((fact) => fact.kind === "reducer").map(item), input.maxItems, 80);
  const reads = bounded(facts.filter((fact) => fact.kind === "redux_read").map(item), input.maxItems, 80);
  const writes = bounded(facts.filter((fact) => fact.kind === "redux_write").map(item), input.maxItems, 80);
  const slices = reducers.map((reducer) => ({ ...reducer, symbol: reducer.symbol.replace(/Reducer$/, "") }));
  const pairSide = maxPairSide(maxLinks);
  const pairedReads = reads.slice(0, pairSide);
  const pairedSelectors = selectors.slice(0, pairSide);
  const totalCandidateLinks = reads.length * selectors.length;
  const links = pairedReads.flatMap((read) => pairedSelectors.map((selector) => ({ from: read.symbol, to: selector.symbol, status: "Needs Verification" as const, evidenceRefs: [`${read.file}:${read.line}`, `${selector.file}:${selector.line}`] }))).slice(0, maxLinks);
  return { slices, reducers, selectors, reads, writes, links, omittedLinks: Math.max(0, totalCandidateLinks - links.length) };
}

export async function createAuthPermissionTrace(root: string, input: Record<string, unknown>): Promise<AuthPermissionTraceResult> {
  const maxLinks = extensionPositiveInteger(input.maxLinks, 160);
  const facts = bounded((await scanFacts(root, input, 80)).filter((fact) => fact.kind === "auth_condition"), input.maxConditions, 120);
  const conditions = facts.map((fact) => ({
    layer: fact.file.includes("/ui/") ? "ui" : fact.file.includes("/api/") ? "api" : "backend",
    kind: fact.file.includes("/ui/") ? "visible_or_enabled" : "authorization",
    expression: fact.symbol,
    evidenceRef: refOf(fact),
    status: fact.status,
  }));
  const backend = conditions.filter((condition) => condition.layer === "backend");
  const nonBackend = conditions.filter((condition) => condition.layer !== "backend");
  const pairSide = maxPairSide(maxLinks);
  const totalCandidateLinks = nonBackend.length * backend.length;
  const links = nonBackend.slice(0, pairSide)
    .flatMap((condition) => backend.slice(0, pairSide).map((target) => ({ from: condition.evidenceRef, to: target.evidenceRef, status: "Needs Verification" as const, evidenceRefs: [condition.evidenceRef, target.evidenceRef] })))
    .slice(0, maxLinks);
  return {
    conditions,
    links,
    omittedLinks: Math.max(0, totalCandidateLinks - links.length),
    unknowns: backend.length === 0 ? ["No backend authorization evidence found"] : [],
    risks: ["backend authorization evidence must be verified independently from UI visibility"],
  };
}

export async function createErrorTransactionMap(root: string, input: Record<string, unknown>): Promise<ErrorTransactionMapResult> {
  const facts = await scanFacts(root, input, 80);
  const errorHandlers = bounded(facts.filter((fact) => fact.kind === "error_handler").map((fact) => ({ kind: fact.text.includes("catch") ? "catch" : "failure", evidenceRef: refOf(fact), status: fact.status })), input.maxItems, 80);
  const transactionBoundaries = bounded(facts.filter((fact) => fact.kind === "transaction").map((fact) => ({ kind: "transaction", evidenceRef: refOf(fact), status: fact.status })), input.maxItems, 80);
  return {
    errorHandlers,
    transactionBoundaries,
    rollbackOrCompensation: bounded(facts.filter((fact) => /rollback|compensat/i.test(fact.text)).map(refOf), input.maxItems, 80),
    userMessages: bounded(facts.filter((fact) => /toast|alert|message/i.test(fact.text)).map(refOf), input.maxItems, 80),
    risks: transactionBoundaries.length === 0 ? ["No transaction boundary evidence found"] : [],
    recommendedTests: ["error path preserves user-visible failure", "transaction or RFC failure does not leave partial state"],
  };
}

async function collectTestFiles(root: string, dir: string, acc: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory() && !["node_modules", ".git", "dist"].includes(entry.name)) await collectTestFiles(root, absolute, acc);
    if (entry.isFile() && /\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) acc.push(portableRelative(root, absolute));
  }
}

export async function createTestImpactPlanner(root: string, input: Record<string, unknown>): Promise<TestImpactPlannerResult> {
  const configuredRoot = await resolveExistingPathInsideRoot(root, ".");
  const base = configuredRoot ?? root;
  const tests: string[] = [];
  await collectTestFiles(base, base, tests);
  const changeSummary = extensionTextInput(input.changeRequest, extensionTextInput(input.changeRequestPath, "Unspecified change request"));
  return {
    changeSummary,
    impactedAreas: ["UI", "FE flow", "API", "Backend", "DB/RFC", "Tests"],
    existingTestCandidates: bounded(tests.sort().map((testPath) => ({ path: testPath, evidenceRef: `${testPath}:1` })), input.maxTests, 80),
    missingTestCases: bounded(["Add edge test for changed validation", "Add backend failure/rollback test", "Add artifact QA evidence for updated flow"], input.maxMissingTestCases, 8),
    verificationCommands: ["npm test", "legacy_repo_index targetPath=.", "evidence_qa repoIndex=<repo_index> matrix=<traceability_matrix>"],
    unknowns: tests.length === 0 ? ["No existing tests found"] : [],
  };
}
