import type { WikiDocumentRef, WikiFreshness, WikiGeneratedFrom, WikiIndex, WikiWarningCode } from "./wiki-types.js";

type JsonRecord = { readonly [key: string]: unknown };

export class WikiIndexReadError extends Error {
  readonly name = "WikiIndexReadError";

  constructor(readonly code: WikiWarningCode, readonly file: string, message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export function parseWikiIndex(raw: string, file: string): WikiIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new WikiIndexReadError("malformed_wiki_index", file, "Malformed wiki index JSON.", { cause: error });
    }
    throw error;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed["documents"])) {
    throw new WikiIndexReadError("malformed_wiki_index", file, "Wiki index must contain a documents array.");
  }
  const documents = parsed["documents"].map((value) => parseDocumentRef(value, file)).sort(compareDocumentRefs);
  return { documents };
}

function parseDocumentRef(value: unknown, file: string): WikiDocumentRef {
  if (!isRecord(value)) throw new WikiIndexReadError("malformed_wiki_index", file, "Wiki document ref must be an object.");
  const id = requiredString(value, "id", file);
  const sourcePath = requiredString(value, "path", file);
  const canonical = requiredBoolean(value, "canonical", file);
  const tags = requiredStringArray(value, "tags", file);
  const freshness = parseFreshness(requiredString(value, "freshness", file), file);
  const title = optionalString(value, "title", file);
  const summary = optionalString(value, "summary", file);
  const aliases = optionalStringArray(value, "aliases", file);
  const links = optionalStringArray(value, "links", file);
  const backlinks = optionalStringArray(value, "backlinks", file);
  const sourceHash = optionalString(value, "sourceHash", file);
  const generatedFrom = optionalGeneratedFrom(value["generatedFrom"], file);

  return {
    id,
    path: sourcePath,
    canonical,
    tags,
    freshness,
    ...(title === undefined ? {} : { title }),
    ...(summary === undefined ? {} : { summary }),
    ...(aliases === undefined ? {} : { aliases }),
    ...(links === undefined ? {} : { links }),
    ...(backlinks === undefined ? {} : { backlinks }),
    ...(sourceHash === undefined ? {} : { sourceHash }),
    ...(generatedFrom === undefined ? {} : { generatedFrom }),
  };
}

function compareDocumentRefs(a: WikiDocumentRef, b: WikiDocumentRef): number {
  return a.path.localeCompare(b.path) || a.id.localeCompare(b.id);
}

function parseFreshness(value: string, file: string): WikiFreshness {
  switch (value) {
    case "manual":
    case "on-merge":
    case "generated":
      return value;
    default:
      throw new WikiIndexReadError("malformed_wiki_index", file, `Unsupported wiki freshness: ${value}`);
  }
}

function optionalGeneratedFrom(value: unknown, file: string): WikiGeneratedFrom | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new WikiIndexReadError("malformed_wiki_index", file, "generatedFrom must be an object.");
  const tool = requiredString(value, "tool", file);
  if (tool !== "repo_map" && tool !== "manual") {
    throw new WikiIndexReadError("malformed_wiki_index", file, `Unsupported generatedFrom tool: ${tool}`);
  }
  return { tool, evidenceRefs: requiredStringArray(value, "evidenceRefs", file) };
}

function requiredString(record: JsonRecord, key: string, file: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new WikiIndexReadError("malformed_wiki_index", file, `${key} must be a string.`);
  return value;
}

function optionalString(record: JsonRecord, key: string, file: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new WikiIndexReadError("malformed_wiki_index", file, `${key} must be a string.`);
  return value;
}

function requiredBoolean(record: JsonRecord, key: string, file: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") throw new WikiIndexReadError("malformed_wiki_index", file, `${key} must be a boolean.`);
  return value;
}

function requiredStringArray(record: JsonRecord, key: string, file: string): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new WikiIndexReadError("malformed_wiki_index", file, `${key} must be a string array.`);
  }
  return value;
}

function optionalStringArray(record: JsonRecord, key: string, file: string): readonly string[] | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new WikiIndexReadError("malformed_wiki_index", file, `${key} must be a string array.`);
  }
  return value;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
