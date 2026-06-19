import { normalizedNamingLookupKey } from "./naming-normalize.js";
import { NamingDictionaryReadError, type NamingDictionary, type NamingEntry, type NamingEntryKind, type NamingNamespace } from "./naming-types.js";
import { parseNamingDictionary } from "./naming-dictionary.js";
import type { NamingSymbolRecord } from "./naming-extract.js";

export type NamingErrorCode = "duplicate_public_export" | "duplicate_tool_name" | "semantic_name_conflict" | "blocked_variant" | "reserved_term_misuse" | "malformed_dictionary";
export type NamingWarningCode = "overloaded_stem" | "missing_source_ref" | "missing_meaning" | "duplicate_compatible_entry";
export type NamingPolicyDiagnosticCode = NamingErrorCode | NamingWarningCode;
export type NamingDiagnosticSeverity = "error" | "warning";

export type NamingCandidate = {
  readonly name: string;
  readonly kind: NamingEntryKind;
  readonly namespace: NamingNamespace;
  readonly sourceRefs?: readonly string[];
  readonly meaning?: string;
};

export type NamingDiagnostic = {
  readonly code: NamingPolicyDiagnosticCode;
  readonly severity: NamingDiagnosticSeverity;
  readonly message: string;
  readonly entryIds: readonly string[];
  readonly name: string;
  readonly namespace: string;
  readonly kind: string;
  readonly sourceRefs: readonly string[];
};

export type NamingCheckResult = {
  readonly status: "pass" | "fail";
  readonly diagnostics: readonly NamingDiagnostic[];
};

export type NamingCheckInput = {
  readonly dictionary: unknown;
  readonly symbols?: readonly NamingSymbolRecord[];
  readonly candidate?: NamingCandidate;
};

type NameUse = {
  readonly id: string;
  readonly name: string;
  readonly kind: NamingEntryKind;
  readonly namespace: NamingNamespace;
  readonly sourceRefs: readonly string[];
  readonly meaning: string;
};

type ParseResult = { readonly kind: "dictionary"; readonly dictionary: NamingDictionary } | { readonly kind: "diagnostic"; readonly diagnostic: NamingDiagnostic };

export function checkNamingDictionary(input: NamingCheckInput): NamingCheckResult {
  const parsed = parseDictionary(input.dictionary);
  if (parsed.kind === "diagnostic") return result([parsed.diagnostic]);
  const dictionary = parsed.dictionary;
  const diagnostics = [
    ...checkEntrySemantics(dictionary),
    ...checkSourceDuplicates(input.symbols ?? []),
    ...checkCandidate(input.candidate, dictionary),
    ...checkReservedMisuse(input.symbols ?? [], dictionary),
  ].sort(compareDiagnostics);
  return result(diagnostics);
}

function parseDictionary(input: unknown): ParseResult {
  try {
    return { kind: "dictionary", dictionary: parseNamingDictionary(input, "naming dictionary") };
  } catch (error) {
    if (error instanceof NamingDictionaryReadError) {
      return { kind: "diagnostic", diagnostic: diagnostic("malformed_dictionary", "error", "Naming dictionary is malformed.", [], "", "", "", error.diagnostics.map((item) => item.path)) };
    }
    throw error;
  }
}

function checkEntrySemantics(dictionary: NamingDictionary): readonly NamingDiagnostic[] {
  const groups = new Map<string, NamingEntry[]>();
  for (const entry of dictionary.entries) add(groups, entryKey(entry), entry);
  const diagnostics: NamingDiagnostic[] = [];
  for (const entries of groups.values()) {
    if (entries.length < 2) continue;
    const first = entries[0];
    if (first === undefined) continue;
    const meanings = new Set(entries.map((entry) => entry.meaning.trim()));
    const code = meanings.size === 1 && !statusesContradict(entries) ? "duplicate_compatible_entry" : "semantic_name_conflict";
    diagnostics.push(diagnostic(code, code === "semantic_name_conflict" ? "error" : "warning", code === "semantic_name_conflict" ? "Name has incompatible meanings or statuses." : "Name is duplicated with compatible meaning.", entries.map((entry) => entry.id), first.name, first.namespace, first.kind, flatten(entries.map((entry) => entry.sourceRefs))));
  }
  return diagnostics;
}

function checkSourceDuplicates(symbols: readonly NamingSymbolRecord[]): readonly NamingDiagnostic[] {
  const exports = new Map<string, NamingSymbolRecord[]>();
  const tools = new Map<string, NamingSymbolRecord[]>();
  for (const symbol of symbols) {
    if (symbol.kind === "tool") add(tools, normalizedNamingLookupKey(symbol.name), symbol);
    if (isPublicExportSymbol(symbol)) add(exports, sourceKey(symbol), symbol);
  }
  return [...duplicateDiagnostics(exports, "duplicate_public_export", "Duplicate public export name."), ...duplicateDiagnostics(tools, "duplicate_tool_name", "Duplicate tool name.")];
}

function isPublicExportSymbol(symbol: NamingSymbolRecord): boolean {
  if (symbol.sourceKind === "export") return true;
  if (!symbol.exported || symbol.sourceKind !== "declaration") return false;
  switch (symbol.kind) {
    case "class":
    case "function":
    case "interface":
    case "type":
      return true;
    case "constant":
    case "method":
    case "setting":
    case "term":
    case "tool":
    case "variable":
      return false;
  }
}

function checkCandidate(candidate: NamingCandidate | undefined, dictionary: NamingDictionary): readonly NamingDiagnostic[] {
  if (candidate === undefined) return [];
  const diagnostics: NamingDiagnostic[] = [];
  const sourceRefs = candidate.sourceRefs ?? [];
  if (sourceRefs.length === 0) diagnostics.push(diagnostic("missing_source_ref", "warning", "Candidate has no source reference.", [], candidate.name, candidate.namespace, candidate.kind, []));
  if ((candidate.meaning ?? "").trim().length === 0) diagnostics.push(diagnostic("missing_meaning", "warning", "Candidate has no meaning.", [], candidate.name, candidate.namespace, candidate.kind, sourceRefs));
  const reservedMisuse = dictionary.entries.find((entry) => entry.namespace === "model-settings" && entry.kind === "setting" && entry.status === "reserved" && candidate.namespace !== "model-settings" && entry.normalized === normalizedNamingLookupKey(candidate.name));
  if (reservedMisuse !== undefined) diagnostics.push(diagnostic("reserved_term_misuse", "error", "Reserved model setting name is used outside model-settings.", [reservedMisuse.id], candidate.name, candidate.namespace, candidate.kind, sourceRefs));
  for (const entry of dictionary.entries) {
    if (entry.name !== candidate.name && entry.blockedVariants.some((variant) => normalizedNamingLookupKey(variant) === normalizedNamingLookupKey(candidate.name))) diagnostics.push(diagnostic("blocked_variant", "error", "Candidate matches a blocked variant.", [entry.id], candidate.name, candidate.namespace, candidate.kind, sourceRefs));
    if (entry.collisionGroup === "overloaded-stems" && entry.normalized === normalizedNamingLookupKey(candidate.name)) diagnostics.push(diagnostic("overloaded_stem", "warning", "Candidate uses an overloaded stem.", [entry.id], candidate.name, candidate.namespace, candidate.kind, sourceRefs));
  }
  return diagnostics;
}

function checkReservedMisuse(symbols: readonly NamingSymbolRecord[], dictionary: NamingDictionary): readonly NamingDiagnostic[] {
  const reserved = dictionary.entries.filter((entry) => entry.namespace === "model-settings" && entry.kind === "setting" && entry.status === "reserved");
  const diagnostics: NamingDiagnostic[] = [];
  for (const symbol of symbols) {
    if (symbol.namespace === "model-settings") continue;
    const match = reserved.find((entry) => entry.normalized === normalizedNamingLookupKey(symbol.name));
    if (match !== undefined && !isJustified(symbol, match)) diagnostics.push(diagnostic("reserved_term_misuse", "error", "Reserved model setting name is used outside model-settings.", [match.id], symbol.name, symbol.namespace, symbol.kind, symbol.sourceRefs));
  }
  return diagnostics;
}

function isJustified(symbol: NamingSymbolRecord, entry: NamingEntry): boolean {
  return entry.aliases.some((alias) => normalizedNamingLookupKey(alias) === normalizedNamingLookupKey(symbol.name)) || symbol.sourceRefs.some((sourceRef) => entry.sourceRefs.includes(sourceRef));
}

function statusesContradict(entries: readonly NamingEntry[]): boolean {
  const statuses = new Set(entries.map((entry) => entry.status));
  return (statuses.has("blocked") && (statuses.has("active") || statuses.has("reserved"))) || (statuses.has("active") && statuses.has("reserved"));
}

function duplicateDiagnostics(groups: Map<string, NamingSymbolRecord[]>, code: NamingErrorCode, message: string): readonly NamingDiagnostic[] {
  const diagnostics: NamingDiagnostic[] = [];
  for (const symbols of groups.values()) {
    if (symbols.length < 2) continue;
    const first = symbols[0];
    if (first === undefined) continue;
    diagnostics.push(diagnostic(code, "error", message, symbols.map((symbol) => symbol.symbolId), first.name, first.namespace, first.kind, flatten(symbols.map((symbol) => symbol.sourceRefs))));
  }
  return diagnostics;
}

function result(diagnostics: readonly NamingDiagnostic[]): NamingCheckResult {
  return { status: diagnostics.some((item) => item.severity === "error") ? "fail" : "pass", diagnostics };
}

function entryKey(entry: NamingEntry): string {
  return `${entry.namespace}:${entry.kind}:${entry.normalized}`;
}

function sourceKey(symbol: NamingSymbolRecord): string {
  return `${symbol.namespace}:${symbol.kind}:${symbol.name}`;
}

function add<T>(groups: Map<string, T[]>, key: string, value: T): void {
  const current = groups.get(key);
  if (current === undefined) groups.set(key, [value]);
  else current.push(value);
}

function flatten(values: readonly (readonly string[])[]): readonly string[] {
  return [...new Set(values.flat())].sort();
}

function diagnostic(code: NamingPolicyDiagnosticCode, severity: NamingDiagnosticSeverity, message: string, entryIds: readonly string[], name: string, namespace: string, kind: string, sourceRefs: readonly string[]): NamingDiagnostic {
  return { code, severity, message, entryIds: [...entryIds].sort(), name, namespace, kind, sourceRefs: [...sourceRefs].sort() };
}

function compareDiagnostics(left: NamingDiagnostic, right: NamingDiagnostic): number {
  return left.code.localeCompare(right.code) || left.namespace.localeCompare(right.namespace) || left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name);
}
