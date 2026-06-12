import { createLegacyRepoIndex } from "./legacy-repo-index.js";
import type { LegacyEvidenceFact, LegacyRepoIndexResult } from "./legacy-types.js";

export interface DbCatalogEntry {
  readonly mapperId: string;
  readonly namespace?: string;
  readonly operation: string;
  readonly tables: readonly string[];
  readonly evidence: readonly string[];
}

export interface RfcCatalogEntry {
  readonly functionName: string;
  readonly caller?: string;
  readonly evidence: readonly string[];
}

export interface IntegrationCatalogResult {
  readonly dbCatalog: readonly DbCatalogEntry[];
  readonly rfcCatalog: readonly RfcCatalogEntry[];
  readonly summary: {
    readonly dbCount: number;
    readonly rfcCount: number;
  };
}

function tableCandidates(fact: LegacyEvidenceFact): readonly string[] {
  if (fact.tables && fact.tables.length > 0) return fact.tables;
  const table = fact.text.match(/\b(?:INTO|FROM|UPDATE|JOIN)\s+([A-Z][A-Z0-9_]*)\b/)?.[1];
  return table ? [table] : [];
}

function dbEntries(index: LegacyRepoIndexResult): readonly DbCatalogEntry[] {
  return index.facts
    .filter((fact) => fact.kind === "mybatis_mapper" && fact.symbol && fact.operation)
    .map((fact) => ({
      mapperId: fact.symbol ?? "Unknown",
      operation: fact.operation ?? "unknown",
      tables: tableCandidates(fact),
      evidence: [fact.id],
    }));
}

function rfcEntries(index: LegacyRepoIndexResult): readonly RfcCatalogEntry[] {
  return index.facts
    .filter((fact) => fact.kind === "rfc_call" && fact.symbol)
    .map((fact) => ({
      functionName: fact.symbol ?? "Unknown",
      evidence: [fact.id],
    }));
}

export async function createIntegrationCatalog(root: string, input: Record<string, unknown>): Promise<IntegrationCatalogResult> {
  const index = await createLegacyRepoIndex(root, input);
  const dbCatalog = dbEntries(index);
  const rfcCatalog = rfcEntries(index);
  return {
    dbCatalog,
    rfcCatalog,
    summary: { dbCount: dbCatalog.length, rfcCount: rfcCatalog.length },
  };
}
