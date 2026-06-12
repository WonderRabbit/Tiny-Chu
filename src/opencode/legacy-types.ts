export type LegacyConfidence = "verified" | "inferred" | "unknown" | "needs_verification";

export interface LegacyEvidenceFact {
  readonly id: string;
  readonly kind: string;
  readonly file: string;
  readonly line: number;
  readonly endLine?: number;
  readonly symbol?: string;
  readonly text: string;
  readonly confidence: LegacyConfidence;
  readonly method?: string;
  readonly path?: string;
  readonly operation?: string;
  readonly tables?: readonly string[];
}

export interface LegacyRepoIndexResult {
  readonly root: string;
  readonly scannedFiles: number;
  readonly detectedFrameworks: readonly string[];
  readonly projectMarkers: readonly LegacyEvidenceFact[];
  readonly facts: readonly LegacyEvidenceFact[];
  readonly inventoryMarkdown: string;
  readonly recommendedCommands: readonly string[];
}

export interface LegacyUnknownLink {
  readonly confidence: "unknown";
  readonly symbol: "Unknown";
}

export interface LegacySymbolLink {
  readonly confidence: LegacyConfidence;
  readonly symbol: string;
  readonly file?: string;
  readonly line?: number;
}

export function unknownLink(): LegacyUnknownLink {
  return { confidence: "unknown", symbol: "Unknown" };
}
