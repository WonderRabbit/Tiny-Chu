import { nestedRecords, recordInput, stringField } from "./legacy-input.js";

export interface EvidenceQaResult {
  readonly status: "pass" | "fail";
  readonly criticalBlockers: readonly string[];
  readonly majorWarnings: readonly string[];
  readonly minorIssues: readonly string[];
  readonly missingEvidence: readonly string[];
  readonly hallucinationSuspects: readonly string[];
  readonly requiredFixes: readonly string[];
  readonly verificationCommands: readonly string[];
}

function factIds(input: Record<string, unknown>): Set<string> {
  const index = recordInput(input.repoIndex);
  return new Set(nestedRecords(index, "facts").map((fact) => stringField(fact, "id")).filter((id) => id !== ""));
}

function factSymbols(input: Record<string, unknown>): Set<string> {
  const index = recordInput(input.repoIndex);
  return new Set(nestedRecords(index, "facts").map((fact) => stringField(fact, "symbol")).filter((symbol) => symbol !== ""));
}

function matrixRows(input: Record<string, unknown>): readonly Record<string, unknown>[] {
  return nestedRecords(recordInput(input.matrix), "rows");
}

function referencedSymbols(input: Record<string, unknown>): readonly string[] {
  const value = input.referencedSymbols;
  return Array.isArray(value) ? value.flatMap((item) => typeof item === "string" ? [item] : []) : [];
}

function matrixEvidence(rows: readonly Record<string, unknown>[]): readonly string[] {
  return rows.flatMap((row) => Array.isArray(row.evidence) ? row.evidence.flatMap((item) => typeof item === "string" ? [item] : []) : []);
}

export function createEvidenceQa(input: Record<string, unknown>): EvidenceQaResult {
  const ids = factIds(input);
  const symbols = factSymbols(input);
  const rows = matrixRows(input);
  const missingEvidence = matrixEvidence(rows).filter((id) => !ids.has(id));
  const hallucinationSuspects = referencedSymbols(input).filter((symbol) => !symbols.has(symbol));
  const missingUnknown = rows.filter((row) => stringField(row, "status") !== "complete" && stringField(row, "gap") === "").map((row) => stringField(row, "feature", "Unknown feature"));
  const criticalBlockers = [
    ...hallucinationSuspects.map((symbol) => `Referenced symbol has no evidence: ${symbol}`),
    ...missingEvidence.map((id) => `Evidence id is missing from repository index: ${id}`),
    ...missingUnknown.map((feature) => `Partial trace lacks Unknown gap handling: ${feature}`),
  ];
  return {
    status: criticalBlockers.length > 0 ? "fail" : "pass",
    criticalBlockers,
    majorWarnings: rows.length === 0 ? ["No traceability rows supplied"] : [],
    minorIssues: [],
    missingEvidence,
    hallucinationSuspects,
    requiredFixes: criticalBlockers.map((blocker) => `Fix: ${blocker}`),
    verificationCommands: [
      "legacy_repo_index targetPath=.",
      "traceability_matrix feature=<feature>",
      "evidence_qa repoIndex=<repo_index> matrix=<traceability_matrix>",
    ],
  };
}
