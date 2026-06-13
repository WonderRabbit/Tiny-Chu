import { nestedRecords, recordInput, stringField } from "./legacy-input.js";

export type ClaimDiagnosticCode = "missing_repo_index" | "missing_evidence_refs" | "unsupported_symbol";

export interface ClaimEvidenceDiagnostic {
  readonly code: ClaimDiagnosticCode;
  readonly message: string;
  readonly symbol?: string;
}

export interface ClaimEvidenceCheckResult {
  readonly valid: boolean;
  readonly diagnostics: readonly ClaimEvidenceDiagnostic[];
  readonly supportedSymbols: readonly string[];
  readonly claimedSymbols: readonly string[];
}

function evidenceRefs(input: Record<string, unknown>): readonly string[] {
  return Array.isArray(input.evidenceRefs) ? input.evidenceRefs.flatMap((item) => typeof item === "string" ? [item] : []) : [];
}

function repoSymbols(input: Record<string, unknown>): readonly string[] {
  const facts = nestedRecords(recordInput(input.repoIndex), "facts");
  return [...new Set(facts.map((fact) => stringField(fact, "symbol")).filter((symbol) => symbol !== ""))].sort();
}

function claimedSymbols(markdown: string): readonly string[] {
  const matches = [
    ...markdown.matchAll(/\bZ_[A-Z0-9_]+\b/g),
    ...markdown.matchAll(/\b[A-Z][A-Za-z0-9_]*(?:Controller|Service|Mapper)\.[A-Za-z_$][\w$]*\b/g),
    ...markdown.matchAll(/\b[A-Z][A-Z0-9_]{2,}\b/g),
  ].map((match) => match[0]);
  return [...new Set(matches)].sort();
}

export function createClaimEvidenceCheck(input: Record<string, unknown>): ClaimEvidenceCheckResult {
  const markdown = typeof input.markdown === "string" ? input.markdown : "";
  const supportedSymbols = repoSymbols(input);
  const claims = claimedSymbols(markdown);
  const supported = new Set(supportedSymbols);
  const diagnostics: ClaimEvidenceDiagnostic[] = [];
  if (supportedSymbols.length === 0) diagnostics.push({ code: "missing_repo_index", message: "A repoIndex with symbol facts is required." });
  if (evidenceRefs(input).length === 0) diagnostics.push({ code: "missing_evidence_refs", message: "At least one evidence ref is required." });
  for (const symbol of claims) {
    if (!supported.has(symbol)) diagnostics.push({ code: "unsupported_symbol", symbol, message: `Claimed symbol has no evidence: ${symbol}` });
  }
  return { valid: diagnostics.length === 0, diagnostics, supportedSymbols, claimedSymbols: claims };
}
