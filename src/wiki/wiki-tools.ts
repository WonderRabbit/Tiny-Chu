import { renderWikiContext } from "./wiki-context.js";
import { searchWiki } from "./wiki-search.js";
import type { WikiContextInput, WikiContextMode, WikiContextResult, WikiSearchInput, WikiSearchResult } from "./wiki-types.js";

class WikiToolInputError extends Error {
  readonly name = "WikiToolInputError";

  constructor(readonly field: string) {
    super(`Invalid wiki tool input field: ${field}`);
  }
}

export async function createWikiSearch(root: string | undefined, input: Record<string, unknown>): Promise<WikiSearchResult> {
  return searchWiki(root, {
    query: optionalString(input.query),
    ids: optionalStringArray(input.ids),
    tags: optionalStringArray(input.tags),
    maxChunks: optionalNumber(input.maxChunks),
    maxChunkChars: optionalNumber(input.maxChunkChars),
    includeNonCanonical: optionalBoolean(input.includeNonCanonical),
  });
}

export async function createWikiContext(root: string | undefined, input: Record<string, unknown>): Promise<WikiContextResult> {
  return renderWikiContext(root, {
    mode: contextMode(input),
    query: optionalString(input.query),
    refs: optionalStringArray(input.refs),
    tags: optionalStringArray(input.tags),
    maxChunks: optionalNumber(input.maxChunks),
    maxChars: optionalNumber(input.maxChars),
    maxChunkChars: optionalNumber(input.maxChunkChars),
    includeIndex: optionalBoolean(input.includeIndex),
    includeNonCanonical: optionalBoolean(input.includeNonCanonical),
  });
}

function contextMode(input: Record<string, unknown>): WikiContextMode {
  const explicit = optionalString(input.mode);
  if (explicit === "index" || explicit === "query" || explicit === "refs") return explicit;
  if (explicit !== undefined) throw new WikiToolInputError("mode");
  if (optionalStringArray(input.refs).length > 0) return "refs";
  if (optionalString(input.query) !== undefined) return "query";
  return "index";
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new WikiToolInputError("string");
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function optionalStringArray(value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new WikiToolInputError("string array");
  return value.map((item) => item.trim()).filter((item) => item !== "");
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new WikiToolInputError("number");
  return value;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new WikiToolInputError("boolean");
  return value;
}
