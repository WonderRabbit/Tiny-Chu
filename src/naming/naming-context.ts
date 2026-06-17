import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildNamingIndex } from "./naming-index.js";
import { normalizedNamingLookupKey, normalizedNamingToken } from "./naming-normalize.js";
import { parseNamingDictionary } from "./naming-dictionary.js";
import type { NamingEntry, NamingEntryKind, NamingNamespace } from "./naming-types.js";

export type NamingContextFormat = "json" | "markdown";
export type NamingContextWarningCode = "empty_query" | "max_entries_clamped" | "no_matches";

export type NamingContextWarning = {
  readonly code: NamingContextWarningCode;
  readonly message: string;
  readonly requestedValue?: number;
  readonly appliedValue?: number;
};

export type NamingContextInput = {
  readonly root?: string;
  readonly query: string;
  readonly namespace?: NamingNamespace;
  readonly kind?: NamingEntryKind;
  readonly maxEntries?: number;
  readonly format?: NamingContextFormat;
};

export type NamingContextEntry = Pick<
  NamingEntry,
  "id" | "name" | "kind" | "namespace" | "casing" | "tokens" | "status" | "aliases" | "blockedVariants" | "sourceRefs" | "meaning"
> & {
  readonly score: number;
};

export type NamingContextMetadata = {
  readonly requestedEntries: number;
  readonly appliedEntries: number;
  readonly returnedEntries: number;
  readonly omittedEntries: number;
  readonly truncated: boolean;
};

export type NamingContextResult = {
  readonly query: string;
  readonly namespace?: NamingNamespace;
  readonly kind?: NamingEntryKind;
  readonly format: NamingContextFormat;
  readonly matchedEntries: readonly NamingContextEntry[];
  readonly warnings: readonly NamingContextWarning[];
  readonly omittedCount: number;
  readonly truncated: boolean;
  readonly metadata: NamingContextMetadata;
  readonly text: string;
};

const DEFAULT_MAX_ENTRIES = 5;
const MAX_ENTRIES = 25;

type EntryScore = {
  readonly entry: NamingEntry;
  readonly score: number;
};

export async function createNamingContext(input: NamingContextInput): Promise<NamingContextResult> {
  const root = path.resolve(input.root ?? process.cwd());
  const format = input.format ?? "json";
  const query = input.query.trim();
  const queryKey = normalizedNamingLookupKey(query);
  const limit = normalizeEntryLimit(input.maxEntries);
  const warnings: NamingContextWarning[] = [...limit.warnings];

  if (queryKey.length === 0) {
    warnings.push({ code: "empty_query", message: "Naming context query is empty." });
    return resultFor({ input, query, format, entries: [], warnings, limit, totalMatches: 0 });
  }

  const dictionaryPath = path.join(root, "docs", "naming", "dictionary.json");
  const dictionary = parseNamingDictionary(await readFile(dictionaryPath, "utf8"), dictionaryPath);
  const index = buildNamingIndex(dictionary);
  const entriesById = new Map(index.entries.map((entry) => [entry.id, entry]));
  const candidateIds = collectCandidateIds(index.byExactName[query], index.byNormalizedName[queryKey], index.byToken[queryKey]);

  for (const entry of index.entries) {
    if (entry.aliases.some((alias) => normalizedNamingLookupKey(alias) === queryKey)) candidateIds.add(entry.id);
    if (entry.blockedVariants.some((variant) => normalizedNamingLookupKey(variant) === queryKey)) candidateIds.add(entry.id);
  }

  const scored = [...candidateIds]
    .map((id) => entriesById.get(id))
    .filter((entry): entry is NamingEntry => entry !== undefined)
    .filter((entry) => matchesScope(entry, input))
    .map((entry) => ({ entry, score: scoreEntry(entry, query, queryKey) }))
    .filter((match) => match.score > 0)
    .sort(compareScoredEntries);

  if (scored.length === 0) warnings.push({ code: "no_matches", message: "No naming entries matched the request." });
  return resultFor({ input, query, format, entries: scored.slice(0, limit.value), warnings, limit, totalMatches: scored.length });
}

function normalizeEntryLimit(maxEntries: number | undefined): { readonly value: number; readonly requested: number; readonly warnings: readonly NamingContextWarning[] } {
  const requested = maxEntries === undefined || !Number.isFinite(maxEntries) ? DEFAULT_MAX_ENTRIES : Math.floor(maxEntries);
  if (requested > MAX_ENTRIES) {
    return {
      value: MAX_ENTRIES,
      requested,
      warnings: [{ code: "max_entries_clamped", message: `maxEntries must be at most ${MAX_ENTRIES}; using ${MAX_ENTRIES}.`, requestedValue: requested, appliedValue: MAX_ENTRIES }],
    };
  }
  return { value: Math.max(0, requested), requested, warnings: [] };
}

function collectCandidateIds(...groups: readonly (readonly string[] | undefined)[]): Set<string> {
  const ids = new Set<string>();
  for (const group of groups) {
    for (const id of group ?? []) ids.add(id);
  }
  return ids;
}

function matchesScope(entry: NamingEntry, input: NamingContextInput): boolean {
  if (input.namespace !== undefined && entry.namespace !== input.namespace) return false;
  if (input.kind !== undefined && entry.kind !== input.kind) return false;
  return true;
}

function scoreEntry(entry: NamingEntry, query: string, queryKey: string): number {
  let score = 0;
  if (entry.name === query) score += 40;
  if (entry.normalized === queryKey) score += 35;
  if (entry.aliases.some((alias) => normalizedNamingLookupKey(alias) === queryKey)) score += 25;
  if (entry.blockedVariants.some((variant) => normalizedNamingLookupKey(variant) === queryKey)) score += 20;
  if (entry.tokens.some((token) => normalizedNamingToken(token) === queryKey)) score += 10;
  return score;
}

function resultFor(input: {
  readonly input: NamingContextInput;
  readonly query: string;
  readonly format: NamingContextFormat;
  readonly entries: readonly EntryScore[];
  readonly warnings: readonly NamingContextWarning[];
  readonly limit: { readonly value: number; readonly requested: number };
  readonly totalMatches: number;
}): NamingContextResult {
  const matchedEntries = input.entries.map(({ entry, score }) => ({ ...entry, score }));
  const omittedEntries = Math.max(0, input.totalMatches - matchedEntries.length);
  const metadata = {
    requestedEntries: input.limit.requested,
    appliedEntries: input.limit.value,
    returnedEntries: matchedEntries.length,
    omittedEntries,
    truncated: omittedEntries > 0,
  };
  const base = {
    query: input.query,
    namespace: input.input.namespace,
    kind: input.input.kind,
    format: input.format,
    matchedEntries,
    warnings: input.warnings,
    omittedCount: omittedEntries,
    truncated: metadata.truncated,
    metadata,
  };
  return { ...base, text: renderText(input.format, base) };
}

function renderText(format: NamingContextFormat, result: Omit<NamingContextResult, "text">): string {
  switch (format) {
    case "json":
      return JSON.stringify(result, null, 2);
    case "markdown":
      return renderMarkdown(result);
  }
}

function renderMarkdown(result: Omit<NamingContextResult, "text">): string {
  const lines = [
    "# Naming Context",
    `query: ${result.query}`,
    `returned: ${result.metadata.returnedEntries}`,
    `omitted: ${result.metadata.omittedEntries}`,
    `truncated: ${String(result.metadata.truncated)}`,
  ];
  for (const entry of result.matchedEntries) {
    lines.push("", `## ${entry.name}`, `id: ${entry.id}`, `kind: ${entry.kind}`, `namespace: ${entry.namespace}`, `casing: ${entry.casing}`, `status: ${entry.status}`, `blockedVariants: ${entry.blockedVariants.join(", ") || "none"}`, entry.meaning);
  }
  if (result.warnings.length > 0) {
    lines.push("", "## Warnings", ...result.warnings.map((warning) => `- ${warning.code}: ${warning.message}`));
  }
  return lines.join("\n");
}

function compareScoredEntries(left: EntryScore, right: EntryScore): number {
  return right.score - left.score || left.entry.id.localeCompare(right.entry.id);
}
