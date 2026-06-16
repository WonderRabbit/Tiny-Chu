import { chunkMarkdownDocument } from "./wiki-chunks.js";
import { readWikiDocuments, readWikiIndex } from "./wiki-reader.js";
import type { ReadWikiDocument } from "./wiki-reader.js";
import type { WikiChunkRecord, WikiSearchInput, WikiSearchMatch, WikiSearchResult, WikiWarning } from "./wiki-types.js";

const TOKEN_PATTERN = /[\p{L}\p{N}_-]+/gu;
const DEFAULT_MAX_RESULTS = 20;
const MAX_SEARCH_RESULTS = 100;

type NormalizedResultLimit = {
  readonly value: number;
  readonly warnings: readonly WikiWarning[];
};

export async function searchWiki(root: string | undefined, input: WikiSearchInput = {}): Promise<WikiSearchResult> {
  const indexResult = await readWikiIndex(root);
  const query = normalizeWikiQuery(input.query ?? "");
  const tokens = tokenizeWikiText(query);
  const ids = input.ids ?? [];
  const tags = input.tags ?? [];
  const warnings: WikiWarning[] = [...indexResult.warnings];
  const resultLimit = normalizeMaxResults(input.maxChunks);
  warnings.push(...resultLimit.warnings);

  if (tokens.length === 0 && ids.length === 0 && tags.length === 0) {
    return {
      query,
      tokens,
      results: [],
      warnings: [...warnings, { code: "empty_query", message: "Wiki search query is empty." }],
    };
  }

  const readResult = await readWikiDocuments({
    root,
    index: indexResult.index,
    ids,
    tags,
    canonicalOnly: ids.length === 0 && input.includeNonCanonical !== true,
    explicitSingleRef: ids.length === 1 && tags.length === 0,
  });
  warnings.push(...readResult.warnings);

  const chunks = readResult.documents.flatMap((document) => {
    const chunkResult = chunkMarkdownDocument({
      document: document.ref,
      sourcePath: document.sourcePath,
      sourceHash: document.sourceHash,
      text: document.text,
      maxChunkChars: input.maxChunkChars,
    });
    warnings.push(...chunkResult.warnings);
    return chunkResult.chunks.map((chunk) => ({
      chunk,
      document,
    }));
  });

  const matches = new Map<string, WikiSearchMatch>();
  for (const entry of chunks) {
    const score = scoreChunk(entry.document, entry.chunk, query, tokens, ids, tags);
    if (score <= 0 && tokens.length > 0) continue;
    if (score <= 0 && (ids.length > 0 || tags.length > 0)) continue;
    matches.set(entry.chunk.id, { ...entry.chunk, score });
  }

  const results = [...matches.values()].sort(compareSearchMatches).slice(0, resultLimit.value);
  if (results.length === 0) warnings.push({ code: "no_matches", message: "No wiki chunks matched the request." });

  return { query, tokens, results, warnings };
}

export function normalizeWikiQuery(query: string): string {
  return query.normalize("NFC").toLocaleLowerCase("en-US").trim().replace(/\s+/gu, " ");
}

export function tokenizeWikiText(text: string): readonly string[] {
  const matches = normalizeWikiQuery(text).match(TOKEN_PATTERN);
  if (!matches) return [];
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const match of matches) {
    if (seen.has(match)) continue;
    seen.add(match);
    tokens.push(match);
  }
  return tokens;
}

function scoreChunk(
  document: ReadWikiDocument,
  chunk: WikiChunkRecord,
  query: string,
  tokens: readonly string[],
  ids: readonly string[],
  tags: readonly string[],
): number {
  const ref = document.ref;
  const normalizedIds = ids.map(normalizeWikiQuery);
  const normalizedTags = tags.map(normalizeWikiQuery);
  let score = 0;

  if (query.length > 0 && normalizeWikiQuery(ref.id) === query) score += 20;
  if (normalizedIds.includes(normalizeWikiQuery(ref.id)) || (ref.aliases ?? []).some((alias) => normalizedIds.includes(normalizeWikiQuery(alias)))) {
    score += 20;
  }
  if (tokens.some((token) => ref.tags.map(normalizeWikiQuery).includes(token)) || ref.tags.some((tag) => normalizedTags.includes(normalizeWikiQuery(tag)))) {
    score += 12;
  }
  if ((ref.aliases ?? []).some((alias) => tokens.includes(normalizeWikiQuery(alias)))) score += 6;
  if (fieldHasToken(ref.title, tokens)) score += 8;
  if (fieldHasToken(ref.summary, tokens)) score += 5;
  if (tokens.length > 0 && chunk.headingPath.some((heading) => fieldHasToken(heading, tokens))) score += 5;

  const chunkTokens = tokenizeAllOccurrences(chunk.text);
  let tokenHits = 0;
  for (const token of tokens) {
    tokenHits += chunkTokens.filter((chunkToken) => chunkToken === token).length;
  }
  score += Math.min(20, tokenHits * 2);

  const headingText = normalizeWikiQuery(chunk.headingPath.join(" "));
  const chunkText = normalizeWikiQuery(chunk.text);
  if (query.length > 0 && headingText.includes(query)) score += 10;
  if (query.length > 0 && chunkText.includes(query)) score += 10;
  return score;
}

function fieldHasToken(value: string | undefined, tokens: readonly string[]): boolean {
  if (value === undefined) return false;
  const fieldTokens = tokenizeWikiText(value);
  return tokens.some((token) => fieldTokens.includes(token));
}

function tokenizeAllOccurrences(text: string): readonly string[] {
  const matches = normalizeWikiQuery(text).match(TOKEN_PATTERN);
  return matches ?? [];
}

function normalizeMaxResults(maxChunks: number | undefined): NormalizedResultLimit {
  if (maxChunks === undefined || !Number.isFinite(maxChunks)) return { value: DEFAULT_MAX_RESULTS, warnings: [] };
  const requested = Math.floor(maxChunks);
  if (requested > MAX_SEARCH_RESULTS) {
    return {
      value: MAX_SEARCH_RESULTS,
      warnings: [{
        code: "max_results_clamped",
        message: `maxChunks must be at most ${MAX_SEARCH_RESULTS}; using ${MAX_SEARCH_RESULTS}.`,
        requestedValue: requested,
        appliedValue: MAX_SEARCH_RESULTS,
      }],
    };
  }
  return { value: Math.max(0, requested), warnings: [] };
}

function compareSearchMatches(a: WikiSearchMatch, b: WikiSearchMatch): number {
  return b.score - a.score
    || a.sourcePath.localeCompare(b.sourcePath)
    || a.startLine - b.startLine
    || a.documentId.localeCompare(b.documentId)
    || a.ordinal - b.ordinal;
}
