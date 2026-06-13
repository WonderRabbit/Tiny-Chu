import { nestedRecords, recordInput, stringField } from "./legacy-input.js";
import { bounded, fieldNames, scanFacts, type EvidenceStatus, type ScanFact } from "./extension-scan.js";

export interface ApiContractCandidate {
  readonly method: string;
  readonly path: string;
  readonly requestKeys: readonly string[];
  readonly responseKeys: readonly string[];
  readonly feCallSites: readonly string[];
  readonly beEntryPoints: readonly string[];
  readonly status: EvidenceStatus;
  readonly evidenceRefs: readonly string[];
}

export interface ApiContractCatalogResult {
  readonly contracts: readonly ApiContractCandidate[];
  readonly mismatches: readonly string[];
  readonly recommendedCommands: readonly string[];
}

export interface DtoSchemaSymbol {
  readonly kind: string;
  readonly name: string;
  readonly source: string;
  readonly evidenceRef: string;
}

export interface DtoSchemaLink {
  readonly from: string;
  readonly to: string;
  readonly relation: string;
  readonly status: EvidenceStatus;
  readonly evidenceRefs: readonly string[];
}

export interface DtoSchemaMapResult {
  readonly symbols: readonly DtoSchemaSymbol[];
  readonly links: readonly DtoSchemaLink[];
  readonly unknowns: readonly string[];
  readonly recommendedCommands: readonly string[];
}

function evidenceRef(fact: ScanFact): string {
  return `${fact.file}:${fact.line}`;
}

function endpointParts(symbol: string): { readonly method: string; readonly path: string } {
  const [method = "UNKNOWN", path = "Unknown"] = symbol.split(/\s+/, 2);
  return { method, path };
}

export async function createApiContractCatalog(root: string, input: Record<string, unknown>): Promise<ApiContractCatalogResult> {
  const facts = await scanFacts(root, input, 120);
  const apiFacts = facts.filter((fact) => fact.kind === "api_client");
  const routeFacts = facts.filter((fact) => fact.kind === "backend_route");
  const keys = bounded(fieldNames(facts), input.maxRequestKeys, 32);
  const endpoints = bounded([...new Set([...apiFacts, ...routeFacts].map((fact) => fact.symbol))].sort(), input.maxEndpoints, 60);
  const contracts = endpoints.map((endpoint) => {
    const fe = apiFacts.filter((fact) => fact.symbol === endpoint);
    const be = routeFacts.filter((fact) => fact.symbol === endpoint);
    const refs = bounded([...fe, ...be].map(evidenceRef), input.maxEvidenceRefs, 24);
    const { method, path } = endpointParts(endpoint);
    return {
      method,
      path,
      requestKeys: keys,
      responseKeys: [],
      feCallSites: bounded(fe.map(evidenceRef), input.maxEvidenceRefs, 24),
      beEntryPoints: bounded(be.map(evidenceRef), input.maxEvidenceRefs, 24),
      status: fe.length > 0 && be.length > 0 ? "Verified" as const : "Needs Verification" as const,
      evidenceRefs: refs,
    };
  });
  const mismatches = contracts.filter((contract) => contract.status !== "Verified").map((contract) => `${contract.method} ${contract.path} missing FE or BE evidence`);
  return {
    contracts,
    mismatches,
    recommendedCommands: ["rg --json 'axios\\.|router\\.(get|post|put|patch|delete)' .", "api_backend_trace method=<method> path=<path>"],
  };
}

function symbolsFromFacts(facts: readonly ScanFact[]): readonly DtoSchemaSymbol[] {
  return facts
    .filter((fact) => ["payload_key", "dto_field", "mapper_param", "rfc_param"].includes(fact.kind))
    .map((fact) => ({ kind: fact.kind, name: fact.symbol, source: fact.file, evidenceRef: evidenceRef(fact) }));
}

function linkSymbols(symbols: readonly DtoSchemaSymbol[]): readonly DtoSchemaLink[] {
  const byName = new Map<string, DtoSchemaSymbol[]>();
  for (const symbol of symbols) byName.set(symbol.name, [...(byName.get(symbol.name) ?? []), symbol]);
  const links: DtoSchemaLink[] = [];
  for (const [name, items] of byName.entries()) {
    const payload = items.find((item) => item.kind === "payload_key");
    for (const target of items.filter((item) => item !== payload)) {
      if (payload) links.push({ from: `${payload.kind}:${name}`, to: `${target.kind}:${name}`, relation: "same-field-evidence", status: target.kind === "dto_field" || target.kind === "mapper_param" ? "Verified" : "Inferred", evidenceRefs: [payload.evidenceRef, target.evidenceRef] });
    }
  }
  return links;
}

export async function createDtoSchemaMap(root: string, input: Record<string, unknown>): Promise<DtoSchemaMapResult> {
  const facts = await scanFacts(root, input, 120);
  const symbols = bounded(symbolsFromFacts(facts), input.maxSymbols, 160);
  const links = bounded(linkSymbols(symbols), input.maxLinks, 160);
  return {
    symbols,
    links,
    unknowns: links.length === 0 ? ["No cross-layer field links verified"] : [],
    recommendedCommands: ["rg --json '#\\{|private String|axios\\.|JCoUtil' .", "context_digest targetPath=<file> query=<field>"],
  };
}

export function contractRows(input: Record<string, unknown>): readonly Record<string, unknown>[] {
  return nestedRecords(recordInput(input.apiContracts), "contracts").filter((row) => stringField(row, "path") !== "");
}
