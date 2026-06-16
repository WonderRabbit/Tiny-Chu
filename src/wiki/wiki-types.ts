export type WikiFreshness = "manual" | "on-merge" | "generated";

export type WikiGeneratedFrom = {
  readonly tool: "repo_map" | "manual";
  readonly evidenceRefs: readonly string[];
};

export type WikiDocumentRef = {
  readonly id: string;
  readonly path: string;
  readonly canonical: boolean;
  readonly tags: readonly string[];
  readonly freshness: WikiFreshness;
  readonly title?: string;
  readonly summary?: string;
  readonly aliases?: readonly string[];
  readonly links?: readonly string[];
  readonly backlinks?: readonly string[];
  readonly sourceHash?: string;
  readonly generatedFrom?: WikiGeneratedFrom;
};

export type WikiIndex = {
  readonly documents: readonly WikiDocumentRef[];
};

export type WikiBundle = {
  readonly refs: readonly WikiDocumentRef[];
  readonly text: string;
};

export type WikiWarningCode =
  | "wiki_index_missing"
  | "malformed_wiki_index"
  | "empty_document"
  | "max_chunk_chars_clamped"
  | "max_context_chars_clamped"
  | "max_context_chunks_clamped"
  | "max_results_clamped"
  | "missing_document"
  | "unreadable_document"
  | "unsafe_document_path"
  | "stale_source_hash"
  | "empty_query"
  | "no_matches"
  | "truncated";

export type WikiWarning = {
  readonly code: WikiWarningCode;
  readonly message: string;
  readonly documentId?: string;
  readonly sourcePath?: string;
  readonly requestedValue?: number;
  readonly appliedValue?: number;
  readonly expectedSourceHash?: string;
  readonly actualSourceHash?: string;
};

export type WikiChunkRecord = {
  readonly id: string;
  readonly documentId: string;
  readonly sourcePath: string;
  readonly sourceHash: string;
  readonly freshness: WikiFreshness;
  readonly ordinal: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly headingPath: readonly string[];
  readonly text: string;
  readonly tokenEstimate: number;
};

export type WikiSearchInput = {
  readonly query?: string;
  readonly ids?: readonly string[];
  readonly tags?: readonly string[];
  readonly maxChunks?: number;
  readonly maxChunkChars?: number;
  readonly includeNonCanonical?: boolean;
};

export type WikiSearchMatch = WikiChunkRecord & {
  readonly score: number;
};

export type WikiSearchResult = {
  readonly query: string;
  readonly tokens: readonly string[];
  readonly results: readonly WikiSearchMatch[];
  readonly warnings: readonly WikiWarning[];
};

export type WikiContextMode = "index" | "query" | "refs";

export type WikiContextInput = {
  readonly mode: WikiContextMode;
  readonly query?: string;
  readonly refs?: readonly string[];
  readonly tags?: readonly string[];
  readonly maxChunks?: number;
  readonly maxChars?: number;
  readonly maxChunkChars?: number;
  readonly includeIndex?: boolean;
  readonly includeNonCanonical?: boolean;
};

export type WikiContextResult = {
  readonly mode: WikiContextMode;
  readonly text: string;
  readonly results: readonly WikiSearchMatch[];
  readonly warnings: readonly WikiWarning[];
  readonly uncertainties: readonly string[];
  readonly omitted: number;
  readonly truncated: boolean;
  readonly maxChars: number;
  readonly maxChunks: number;
};
