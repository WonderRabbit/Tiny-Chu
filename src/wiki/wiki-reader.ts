import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolveExistingPathInsideRoot } from "../state/path-safety.js";
import { resolveTinyChuPaths } from "../state/paths.js";
import { parseWikiIndex } from "./wiki-index-parser.js";
import { resolveWikiIndexReadPath } from "./wiki-storage.js";
import type { WikiDocumentRef, WikiIndex, WikiWarning, WikiWarningCode } from "./wiki-types.js";

export { WikiIndexReadError } from "./wiki-index-parser.js";

export class WikiDocumentReadError extends Error {
  readonly name = "WikiDocumentReadError";

  constructor(
    readonly code: WikiWarningCode,
    readonly documentId: string | undefined,
    readonly sourcePath: string | undefined,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export type ReadWikiIndexResult = { readonly index: WikiIndex; readonly warnings: readonly WikiWarning[] };

export type ReadWikiDocument = { readonly ref: WikiDocumentRef; readonly absolutePath: string; readonly sourcePath: string; readonly text: string; readonly sourceHash: string };

export type ReadWikiDocumentsInput = { readonly root?: string; readonly index: WikiIndex; readonly ids?: readonly string[]; readonly tags?: readonly string[]; readonly canonicalOnly?: boolean; readonly explicitSingleRef?: boolean };

export type ReadWikiDocumentsResult = { readonly documents: readonly ReadWikiDocument[]; readonly warnings: readonly WikiWarning[] };

export async function readWikiIndex(root?: string): Promise<ReadWikiIndexResult> {
  const indexPath = await resolveWikiIndexReadPath(root);
  const file = indexPath.file;
  if (!indexPath.exists) {
    return {
      index: { documents: [] },
      warnings: [{ code: "wiki_index_missing", message: "Wiki index is missing.", sourcePath: file }],
    };
  }
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return {
        index: { documents: [] },
        warnings: [{ code: "wiki_index_missing", message: "Wiki index is missing.", sourcePath: file }],
      };
    }
    throw error;
  }
  return { index: parseWikiIndex(raw, file), warnings: [] };
}

export async function readWikiDocuments(input: ReadWikiDocumentsInput): Promise<ReadWikiDocumentsResult> {
  const root = resolveTinyChuPaths(input.root).root;
  const selected = selectDocuments(input.index.documents, input);
  const warnings: WikiWarning[] = [...missingSelectionWarnings(input.index.documents, input)];
  const documents: ReadWikiDocument[] = [];

  for (const ref of selected) {
    const document = await readOneWikiDocument(root, ref, input.explicitSingleRef === true);
    warnings.push(...document.warnings);
    if (document.document) documents.push(document.document);
  }

  return { documents, warnings };
}

async function readOneWikiDocument(
  root: string,
  ref: WikiDocumentRef,
  explicitSingleRef: boolean,
): Promise<{ readonly document?: ReadWikiDocument; readonly warnings: readonly WikiWarning[] }> {
  let absolutePath: string | undefined;
  try {
    absolutePath = await resolveExistingPathInsideRoot(root, ref.path);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return missingOrUnreadable(ref, error, explicitSingleRef);
  }
  if (!absolutePath) {
    throw new WikiDocumentReadError(
      "unsafe_document_path",
      ref.id,
      ref.path,
      `Wiki document path is outside configured root: ${ref.path}`,
    );
  }

  let text: string;
  try {
    text = await readFile(absolutePath, "utf8");
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return missingOrUnreadable(ref, error, explicitSingleRef);
  }

  const sourceHash = createHash("sha256").update(text).digest("hex");
  const warnings: readonly WikiWarning[] = ref.sourceHash === undefined || ref.sourceHash === sourceHash
    ? []
    : [{
      code: "stale_source_hash",
      message: "Wiki document source hash differs from the index metadata.",
      documentId: ref.id,
      sourcePath: ref.path,
      expectedSourceHash: ref.sourceHash,
      actualSourceHash: sourceHash,
    }];

  return { document: { ref, absolutePath, sourcePath: ref.path, text, sourceHash }, warnings };
}

function missingOrUnreadable(
  ref: WikiDocumentRef,
  error: Error,
  explicitSingleRef: boolean,
): { readonly document?: ReadWikiDocument; readonly warnings: readonly WikiWarning[] } {
  const code = hasErrorCode(error, "ENOENT") ? "missing_document" : "unreadable_document";
  const message = code === "missing_document"
    ? `Wiki document is missing: ${ref.path}`
    : `Wiki document is unreadable: ${ref.path}`;
  if (explicitSingleRef) {
    throw new WikiDocumentReadError(code, ref.id, ref.path, message, { cause: error });
  }
  return { warnings: [{ code, message, documentId: ref.id, sourcePath: ref.path }] };
}

function selectDocuments(documents: readonly WikiDocumentRef[], input: ReadWikiDocumentsInput): readonly WikiDocumentRef[] {
  const ids = new Set(input.ids ?? []);
  const tags = new Set(input.tags ?? []);
  return documents
    .filter((doc) => matchesSelection(doc, ids, tags, input.canonicalOnly === true))
    .sort(compareDocumentRefs);
}

function matchesSelection(doc: WikiDocumentRef, ids: ReadonlySet<string>, tags: ReadonlySet<string>, canonicalOnly: boolean): boolean {
  if (canonicalOnly && !doc.canonical) return false;
  if (ids.size === 0 && tags.size === 0) return true;
  if (ids.has(doc.id) || (doc.aliases ?? []).some((alias) => ids.has(alias))) return true;
  return doc.tags.some((tag) => tags.has(tag));
}

function missingSelectionWarnings(documents: readonly WikiDocumentRef[], input: ReadWikiDocumentsInput): readonly WikiWarning[] {
  const ids = input.ids ?? [];
  if (ids.length === 0) return [];
  const warnings: WikiWarning[] = [];
  for (const id of ids) {
    const found = documents.some((doc) => doc.id === id || (doc.aliases ?? []).includes(id));
    if (found) continue;
    const message = `Wiki document ref is not present in the index: ${id}`;
    if (input.explicitSingleRef === true && ids.length === 1) {
      throw new WikiDocumentReadError("missing_document", id, undefined, message);
    }
    warnings.push({ code: "missing_document", message, documentId: id });
  }
  return warnings;
}

function compareDocumentRefs(a: WikiDocumentRef, b: WikiDocumentRef): number {
  return a.path.localeCompare(b.path) || a.id.localeCompare(b.id);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
