import { createHash } from "node:crypto";
import { readJsonFile } from "../state/file-store.js";
import { resolveWikiIndexReadPath } from "./wiki-storage.js";

export type WikiProposalFreshness = "manual" | "on-merge" | "generated";
export type WikiGeneratedFromTool = "repo_map" | "manual";
export type WikiProposalKind = "new_document" | "metadata_update";

export interface WikiGeneratedFrom {
  readonly tool: WikiGeneratedFromTool;
  readonly evidenceRefs: readonly string[];
}

export interface WikiProposalDocumentRef {
  readonly id: string;
  readonly path: string;
  readonly canonical: boolean;
  readonly tags: readonly string[];
  readonly freshness: WikiProposalFreshness;
  readonly aliases?: readonly string[];
  readonly links?: readonly string[];
  readonly backlinks?: readonly string[];
  readonly sourceHash?: string;
  readonly generatedFrom?: WikiGeneratedFrom;
}

export interface RepoMapWikiProposalFile {
  readonly path: string;
  readonly layer?: string;
  readonly reason?: string;
}

export interface RepoMapWikiProposalLayer {
  readonly name: string;
  readonly files?: readonly string[];
  readonly evidence?: readonly string[];
}

export interface RepoMapWikiProposalFlowHint {
  readonly from: string;
  readonly to: string;
  readonly evidence?: readonly string[];
}

export interface RepoMapWikiProposalInput {
  readonly files?: readonly RepoMapWikiProposalFile[];
  readonly layers?: readonly RepoMapWikiProposalLayer[];
  readonly dataFlowHints?: readonly RepoMapWikiProposalFlowHint[];
}

export interface WikiRepoMapProposal {
  readonly kind: WikiProposalKind;
  readonly documentId: string;
  readonly title: string;
  readonly targetPath: string;
  readonly evidenceRefs: readonly string[];
  readonly proposedRef: WikiProposalDocumentRef;
  readonly currentRef?: WikiProposalDocumentRef;
}

export interface WikiRepoMapProposalResult {
  readonly proposals: readonly WikiRepoMapProposal[];
  readonly warnings: readonly string[];
}

type WikiIndexShape = {
  readonly documents: readonly WikiProposalDocumentRef[];
};

function isReadonlyUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed !== "") seen.add(trimmed);
  }
  return [...seen].sort((left, right) => left.localeCompare(right));
}

function optionalStringArray(record: Record<string, unknown>, key: string): readonly string[] | undefined {
  const value = record[key];
  if (!isReadonlyUnknownArray(value)) return undefined;
  return uniqueSorted(value.flatMap((item) => typeof item === "string" ? [item] : []));
}

function freshness(value: unknown): WikiProposalFreshness {
  switch (value) {
    case "manual":
      return "manual";
    case "on-merge":
      return "on-merge";
    case "generated":
      return "generated";
    default:
      return "manual";
  }
}

function generatedFromTool(value: unknown): WikiGeneratedFromTool | undefined {
  switch (value) {
    case "repo_map":
      return "repo_map";
    case "manual":
      return "manual";
    default:
      return undefined;
  }
}

function optionalGeneratedFrom(value: unknown): WikiGeneratedFrom | undefined {
  if (!isRecord(value)) return undefined;
  const tool = generatedFromTool(value["tool"]);
  if (!tool) return undefined;
  return {
    tool,
    evidenceRefs: optionalStringArray(value, "evidenceRefs") ?? [],
  };
}

function documentRef(value: unknown): WikiProposalDocumentRef | undefined {
  if (!isRecord(value)) return undefined;
  const id = value["id"];
  const path = value["path"];
  const canonical = value["canonical"];
  const tags = optionalStringArray(value, "tags");
  if (typeof id !== "string" || typeof path !== "string" || typeof canonical !== "boolean" || !tags) return undefined;
  const sourceHash = typeof value["sourceHash"] === "string" ? value["sourceHash"] : undefined;
  return {
    id,
    path,
    canonical,
    tags,
    freshness: freshness(value["freshness"]),
    aliases: optionalStringArray(value, "aliases"),
    links: optionalStringArray(value, "links"),
    backlinks: optionalStringArray(value, "backlinks"),
    sourceHash,
    generatedFrom: optionalGeneratedFrom(value["generatedFrom"]),
  };
}

async function readWikiIndex(root: string): Promise<WikiIndexShape> {
  const indexPath = await resolveWikiIndexReadPath(root);
  if (!indexPath.exists) return { documents: [] };
  const raw = await readJsonFile<unknown>(indexPath.file, { documents: [] });
  if (!isRecord(raw) || !isReadonlyUnknownArray(raw["documents"])) return { documents: [] };
  return {
    documents: raw["documents"].flatMap((value) => {
      const ref = documentRef(value);
      return ref ? [ref] : [];
    }).sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function segment(value: string): string {
  const normalized = value.normalize("NFC").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized === "" ? "unknown" : normalized;
}

function title(value: string): string {
  return value.trim().split(/[\s_-]+/).filter((part) => part !== "").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function layerNames(input: RepoMapWikiProposalInput): readonly string[] {
  return uniqueSorted([
    ...(input.layers ?? []).map((layer) => layer.name),
    ...(input.files ?? []).flatMap((file) => file.layer ? [file.layer] : []),
  ]);
}

function evidenceRefs(layerName: string, input: RepoMapWikiProposalInput): readonly string[] {
  const layerEvidence = (input.layers ?? [])
    .filter((layer) => layer.name === layerName)
    .flatMap((layer) => [...(layer.evidence ?? []), ...(layer.files ?? [])]);
  const fileEvidence = (input.files ?? [])
    .filter((file) => file.layer === layerName)
    .map((file) => file.reason ? `${file.path}: ${file.reason}` : file.path);
  const flowEvidence = (input.dataFlowHints ?? [])
    .filter((hint) => hint.from === layerName || hint.to === layerName)
    .flatMap((hint) => hint.evidence ?? []);
  return uniqueSorted([...layerEvidence, ...fileEvidence, ...flowEvidence]);
}

function layerLinks(layerName: string, input: RepoMapWikiProposalInput): readonly string[] {
  return uniqueSorted((input.dataFlowHints ?? []).flatMap((hint) => {
    if (hint.from === layerName) return [`repo-layer-${segment(hint.to)}`];
    if (hint.to === layerName) return [`repo-layer-${segment(hint.from)}`];
    return [];
  }));
}

function sourceHash(layerName: string, refs: readonly string[], links: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify({ layerName, refs, links })).digest("hex");
}

function proposalForLayer(
  layerName: string,
  current: WikiProposalDocumentRef | undefined,
  input: RepoMapWikiProposalInput,
): WikiRepoMapProposal {
  const documentId = `repo-layer-${segment(layerName)}`;
  const refs = evidenceRefs(layerName, input);
  const links = layerLinks(layerName, input);
  const hash = sourceHash(layerName, refs, links);
  const generatedFrom: WikiGeneratedFrom = { tool: "repo_map", evidenceRefs: refs };
  const proposedRef = {
    id: documentId,
    path: current?.path ?? `.tiny/wiki/generated/${documentId}.md`,
    canonical: current?.canonical ?? false,
    tags: uniqueSorted([...(current?.tags ?? []), "generated", "repo-map", layerName]),
    freshness: current?.freshness ?? "generated",
    aliases: uniqueSorted([...(current?.aliases ?? []), `${layerName} layer`]),
    links,
    backlinks: current?.backlinks ?? [],
    sourceHash: hash,
    generatedFrom,
  };
  return {
    kind: current ? "metadata_update" : "new_document",
    documentId,
    title: `${title(layerName)} Layer`,
    targetPath: proposedRef.path,
    evidenceRefs: refs,
    proposedRef,
    currentRef: current,
  };
}

export async function proposeWikiDocumentsFromRepoMap(root: string, input: RepoMapWikiProposalInput): Promise<WikiRepoMapProposalResult> {
  const index = await readWikiIndex(root);
  const currentById = new Map(index.documents.map((document) => [document.id, document]));
  const names = layerNames(input);
  if (names.length === 0) return { proposals: [], warnings: ["repo_map_empty"] };
  const proposals = names.map((name) => {
    const documentId = `repo-layer-${segment(name)}`;
    return proposalForLayer(name, currentById.get(documentId), input);
  });
  return {
    proposals: proposals.sort((left, right) => left.documentId.localeCompare(right.documentId)),
    warnings: [],
  };
}
