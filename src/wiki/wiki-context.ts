import { readWikiIndex } from "./wiki-reader.js";
import { searchWiki } from "./wiki-search.js";
import type { WikiContextInput, WikiContextMode, WikiContextResult, WikiDocumentRef, WikiSearchMatch, WikiWarning } from "./wiki-types.js";

const DEFAULT_MAX_CONTEXT_CHUNKS = 8;
const DEFAULT_MAX_CONTEXT_CHARS = 6000;
const MAX_CONTEXT_CHUNKS = 50;
const MAX_CONTEXT_CHARS = 20000;

type RenderedText = {
  readonly text: string;
  readonly renderedCount: number;
  readonly omitted: number;
  readonly truncated: boolean;
};

type NormalizedContextLimit = {
  readonly value: number;
  readonly warnings: readonly WikiWarning[];
};

class WikiContextModeError extends Error {
  readonly name = "WikiContextModeError";

  constructor(readonly mode: string) {
    super(`Unhandled wiki context mode: ${mode}`);
  }
}

export async function renderWikiContext(root: string | undefined, input: WikiContextInput): Promise<WikiContextResult> {
  const chunkLimit = normalizeLimit(input.maxChunks, DEFAULT_MAX_CONTEXT_CHUNKS, MAX_CONTEXT_CHUNKS, "max_context_chunks_clamped", "maxChunks");
  const charLimit = normalizeLimit(input.maxChars, DEFAULT_MAX_CONTEXT_CHARS, MAX_CONTEXT_CHARS, "max_context_chars_clamped", "maxChars");
  const limitWarnings = [...chunkLimit.warnings, ...charLimit.warnings];

  switch (input.mode) {
    case "index":
      return renderIndexContext(root, input, chunkLimit.value, charLimit.value, limitWarnings);
    case "query":
      return renderSearchContext(root, input, chunkLimit.value, charLimit.value, limitWarnings);
    case "refs":
      return renderSearchContext(root, input, chunkLimit.value, charLimit.value, limitWarnings);
    default:
      return assertNever(input.mode);
  }
}

async function renderIndexContext(root: string | undefined, input: WikiContextInput, maxChunks: number, maxChars: number, limitWarnings: readonly WikiWarning[]): Promise<WikiContextResult> {
  const indexResult = await readWikiIndex(root);
  const documents = input.includeNonCanonical === true
    ? indexResult.index.documents
    : indexResult.index.documents.filter((doc) => doc.canonical);
  const sections = documents.slice(0, maxChunks).map(renderIndexDocument);
  const rendered = renderWithBudget("[wiki-index]\n", sections, maxChars);
  const omitted = Math.max(documents.length - rendered.renderedCount, rendered.omitted);
  const warnings = rendered.truncated
    ? [...indexResult.warnings, ...limitWarnings, truncatedWarning()]
    : [...indexResult.warnings, ...limitWarnings];
  return {
    mode: input.mode,
    text: rendered.text,
    results: [],
    warnings,
    uncertainties: uncertaintyMessages(warnings),
    omitted,
    truncated: rendered.truncated,
    maxChars,
    maxChunks,
  };
}

async function renderSearchContext(root: string | undefined, input: WikiContextInput, maxChunks: number, maxChars: number, limitWarnings: readonly WikiWarning[]): Promise<WikiContextResult> {
  const search = await searchWiki(root, {
    query: input.mode === "query" ? input.query : undefined,
    ids: input.mode === "refs" ? input.refs ?? [] : input.refs,
    tags: input.tags,
    maxChunks,
    maxChunkChars: input.maxChunkChars,
    includeNonCanonical: input.includeNonCanonical,
  });
  const candidates = search.results.slice(0, maxChunks);
  const indexPrefix = input.includeIndex === true ? await renderIndexPrefix(root, input.includeNonCanonical === true) : "";
  const rendered = renderWithBudget(`${headerFor(input)}${indexPrefix}`, candidates.map(renderResultSection), maxChars);
  const renderedResults = candidates.slice(0, rendered.renderedCount);
  const omitted = Math.max(search.results.length - rendered.renderedCount, rendered.omitted);
  const warnings = rendered.truncated
    ? [...search.warnings, ...limitWarnings, truncatedWarning()]
    : [...search.warnings, ...limitWarnings];

  return {
    mode: input.mode,
    text: rendered.text,
    results: renderedResults,
    warnings,
    uncertainties: uncertaintyMessages(warnings),
    omitted,
    truncated: rendered.truncated,
    maxChars,
    maxChunks,
  };
}

async function renderIndexPrefix(root: string | undefined, includeNonCanonical: boolean): Promise<string> {
  const indexResult = await readWikiIndex(root);
  const documents = includeNonCanonical
    ? indexResult.index.documents
    : indexResult.index.documents.filter((doc) => doc.canonical);
  if (documents.length === 0) return "";
  return `${documents.map(renderIndexDocument).join("")}\n`;
}

function headerFor(input: WikiContextInput): string {
  if (input.mode === "query") return `[wiki-context]\nmode=query\nquery=${input.query ?? ""}\n\n`;
  return `[wiki-context]\nmode=refs\nrefs=${(input.refs ?? []).join(",")}\n\n`;
}

function renderIndexDocument(doc: WikiDocumentRef): string {
  const aliases = doc.aliases && doc.aliases.length > 0 ? ` aliases=${doc.aliases.join(",")}` : "";
  return `- id=${doc.id} path=${doc.path} tags=${doc.tags.join(",")} freshness=${doc.freshness} canonical=${doc.canonical}${aliases}\n`;
}

function renderResultSection(result: WikiSearchMatch): string {
  const heading = result.headingPath.length > 0 ? `\nheading=${result.headingPath.join(" > ")}` : "";
  return [
    `[${result.id}] ${result.sourcePath}:${result.startLine}-${result.endLine}`,
    `document=${result.documentId} freshness=${result.freshness} sourceHash=${result.sourceHash} score=${result.score} tokenEstimate=${result.tokenEstimate}${heading}`,
    result.text.trim(),
    "",
  ].join("\n");
}

function renderWithBudget(header: string, sections: readonly string[], maxChars: number): RenderedText {
  let text = header.slice(0, maxChars);
  if (header.length > maxChars) return { text, renderedCount: 0, omitted: sections.length, truncated: true };

  let renderedCount = 0;
  let truncated = false;
  for (const section of sections) {
    const next = `${text.endsWith("\n") ? "" : "\n"}${section}`;
    if (text.length + next.length <= maxChars) {
      text += next;
      renderedCount += 1;
      continue;
    }
    const remaining = maxChars - text.length;
    if (remaining > 0) {
      text += next.slice(0, remaining);
      renderedCount += 1;
    }
    truncated = true;
    break;
  }
  return { text, renderedCount, omitted: sections.length - renderedCount, truncated };
}

function normalizeLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
  warningCode: WikiWarning["code"],
  field: string,
): NormalizedContextLimit {
  if (value === undefined || !Number.isFinite(value)) return { value: fallback, warnings: [] };
  const requested = Math.floor(value);
  if (requested > maximum) {
    return {
      value: maximum,
      warnings: [{
        code: warningCode,
        message: `${field} must be at most ${maximum}; using ${maximum}.`,
        requestedValue: requested,
        appliedValue: maximum,
      }],
    };
  }
  return { value: Math.max(0, requested), warnings: [] };
}

function truncatedWarning(): WikiWarning {
  return { code: "truncated", message: "Wiki context text was truncated by maxChars." };
}

function uncertaintyMessages(warnings: readonly WikiWarning[]): readonly string[] {
  return warnings
    .filter((warning) => warning.code !== "max_chunk_chars_clamped")
    .map((warning) => warning.message);
}

function assertNever(value: never): never {
  throw new WikiContextModeError(String(value));
}
