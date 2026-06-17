import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { PublicDispatcher } from "../dispatcher/public-job.js";
import { resolveExistingPathInsideRoot } from "../state/path-safety.js";
import { bounded, extensionPositiveInteger } from "./extension-scan.js";
import { readLegacySourceFiles } from "./legacy-scanner.js";
import { QWEN_PUBLIC_LIMITS } from "./qwen-retry-policy.js";

export interface WorkerPacketPlan {
  readonly objective: string;
  readonly artifactType?: string;
  readonly formatTemplate?: {
    readonly artifactType: string;
    readonly preparationTool: "artifact_format_template";
  };
  readonly boundedFiles: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly estimatedTokens: number;
  readonly budget: {
    readonly inputTokensMax: number;
    readonly outputTokensMax: number;
    readonly totalTokensHard: number;
  };
  readonly mustReturn: readonly string[];
  readonly retryPolicyInput: {
    readonly estimatedTokens: number;
    readonly status: "queued";
  };
}

export interface WorkerPacketOptimizerResult {
  readonly packets: readonly WorkerPacketPlan[];
  readonly noLiveProviderCalls: boolean;
  readonly dispatchMode: "packet_only" | "public_queue";
  readonly dispatch: {
    readonly mode: "packet_only" | "public_queue";
    readonly requested: boolean;
    readonly publicJobIds: readonly string[];
  };
  readonly ratePlan: {
    readonly requestsPerMinute: number;
    readonly tokensPerMinute: number;
    readonly requestSpacingMs: number;
  };
  readonly dispatchOrder: readonly number[];
  readonly recoverySteps: readonly string[];
}

export interface ArtifactPackManifestResult {
  readonly manifestVersion: 1;
  readonly artifacts: readonly {
    readonly type: string;
    readonly path?: string;
    readonly status: string;
    readonly evidenceRefs: readonly string[];
    readonly qaStatus: string;
    readonly checksum?: string;
    readonly traceIds: readonly string[];
  }[];
  readonly missingArtifacts: readonly string[];
  readonly omittedArtifacts: number;
  readonly blockers: readonly string[];
  readonly publishReady: boolean;
}

export interface IncrementalEvidenceCacheResult {
  readonly cacheKey: string;
  readonly inputs: readonly {
    readonly path: string;
    readonly mtimeMs: number;
    readonly sha256: string;
    readonly status: "fresh" | "stale" | "missing";
  }[];
  readonly outputs: readonly string[];
  readonly staleReasons: readonly string[];
  readonly recommendedRescanTools: readonly string[];
}

const REQUIRED_ARTIFACTS = ["as_is", "ui_definition", "user_story", "test_case", "sequence_diagram", "flowchart", "erd"] as const;

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.flatMap((item) => typeof item === "string" ? [item] : []) : [];
}

function objective(input: Record<string, unknown>): string {
  return typeof input.objective === "string" && input.objective.trim() !== "" ? input.objective : "Analyze bounded repository evidence";
}

function artifactType(input: Record<string, unknown>): string | undefined {
  return typeof input.artifactType === "string" && input.artifactType.trim() !== "" ? input.artifactType : undefined;
}

function artifactRows(input: Record<string, unknown>): readonly Record<string, unknown>[] {
  return Array.isArray(input.artifacts)
    ? input.artifacts.flatMap((item) => typeof item === "object" && item !== null && !Array.isArray(item) ? [Object.fromEntries(Object.entries(item))] : [])
    : [];
}

function textField(record: Record<string, unknown>, key: string, fallback = ""): string {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
}

function estimateTokens(values: readonly string[]): number {
  return Math.max(200, Math.ceil(values.join("\n").length / 4));
}

function chunks(values: readonly string[], size: number): readonly (readonly string[])[] {
  if (values.length === 0) return [[]];
  const result: string[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export async function createWorkerPacketOptimizer(root: string, input: Record<string, unknown>): Promise<WorkerPacketOptimizerResult> {
  const refs = strings(input.evidenceRefs);
  const maxEvidenceRefsPerPacket = extensionPositiveInteger(input.maxEvidenceRefsPerPacket, 24);
  const maxFilesPerPacket = extensionPositiveInteger(input.maxFilesPerPacket, 8);
  const refChunks = bounded(chunks(refs, maxEvidenceRefsPerPacket), input.maxPackets, 6);
  const requiredReturns = strings(input.mustReturn).length > 0 ? strings(input.mustReturn) : ["findings", "citations", "uncertainties", "verificationCommands", "nextSteps"];
  const type = artifactType(input);
  const packets = refChunks.map((chunk) => {
    const files = [...new Set(chunk.map((ref) => ref.split(":")[0]).filter((file) => file !== ""))].sort();
    const estimatedTokens = estimateTokens(chunk);
    return {
      objective: objective(input),
      ...(type ? { artifactType: type, formatTemplate: { artifactType: type, preparationTool: "artifact_format_template" as const } } : {}),
      boundedFiles: files.slice(0, maxFilesPerPacket),
      evidenceRefs: chunk,
      estimatedTokens,
      budget: { inputTokensMax: 2400, outputTokensMax: 1200, totalTokensHard: 4000 },
      mustReturn: bounded(requiredReturns, input.maxMustReturn, 8),
      retryPolicyInput: { estimatedTokens, status: "queued" as const },
    };
  });
  const publicJobIds: string[] = [];
  if (input.dispatch === true) {
    const dispatcher = new PublicDispatcher({ root });
    for (const packet of packets) {
      const job = await dispatcher.dispatch({ prompt: packet.objective, mustReturn: [...packet.mustReturn], budget: packet.budget, artifactType: packet.artifactType });
      publicJobIds.push(job.id);
    }
  }
  const dispatchMode = input.dispatch === true ? "public_queue" : "packet_only";
  return {
    packets,
    noLiveProviderCalls: true,
    dispatchMode,
    dispatch: { mode: dispatchMode, requested: input.dispatch === true, publicJobIds },
    ratePlan: QWEN_PUBLIC_LIMITS,
    dispatchOrder: packets.map((_, index) => index + 1),
    recoverySteps: ["checkpoint before dispatch", "on failure call qwen_retry_policy", "then use public_retry with a smaller packet"],
  };
}

export function createArtifactPackManifest(input: Record<string, unknown>): ArtifactPackManifestResult {
  const rows = artifactRows(input);
  const artifacts = bounded(rows, input.maxArtifacts, 40).map((row) => ({
    type: textField(row, "type", "unknown"),
    ...(textField(row, "path") ? { path: textField(row, "path") } : {}),
    status: textField(row, "status", "unknown"),
    evidenceRefs: strings(row.evidenceRefs),
    qaStatus: textField(row, "qaStatus", "unknown"),
    ...(textField(row, "checksum") ? { checksum: textField(row, "checksum") } : {}),
    traceIds: strings(row.traceIds),
  }));
  const present = new Set(artifacts.map((artifact) => artifact.type));
  const missingArtifacts = REQUIRED_ARTIFACTS.filter((type) => !present.has(type));
  const blockers = [
    ...missingArtifacts.map((type) => `Missing artifact: ${type}`),
    ...artifacts.filter((artifact) => artifact.status !== "pass" || artifact.qaStatus !== "pass").map((artifact) => `Artifact not publish-ready: ${artifact.type}`),
  ];
  return { manifestVersion: 1, artifacts, missingArtifacts, omittedArtifacts: Math.max(0, rows.length - artifacts.length), blockers, publishReady: blockers.length === 0 };
}

function previousMap(input: Record<string, unknown>): Map<string, string> {
  const previous = typeof input.previous === "object" && input.previous !== null && !Array.isArray(input.previous)
    ? Object.fromEntries(Object.entries(input.previous))
    : {};
  const inputs = Array.isArray(previous.inputs) ? previous.inputs : [];
  const map = new Map<string, string>();
  for (const item of inputs) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const record = Object.fromEntries(Object.entries(item));
    if (typeof record.path === "string" && typeof record.sha256 === "string") map.set(record.path, record.sha256);
  }
  return map;
}

export async function createIncrementalEvidenceCache(root: string, input: Record<string, unknown>): Promise<IncrementalEvidenceCacheResult> {
  const target = await resolveExistingPathInsideRoot(root, typeof input.targetPath === "string" ? input.targetPath : ".");
  if (!target) throw new Error("Evidence cache target path is outside configured root");
  const base = await resolveExistingPathInsideRoot(root, ".");
  const configuredRoot = base ?? root;
  const sources = await readLegacySourceFiles(configuredRoot, { targetPath: input.targetPath ?? ".", maxFiles: extensionPositiveInteger(input.maxInputs, 80) });
  const previous = previousMap(input);
  const inputs = await Promise.all(sources.map(async (source) => {
    const info = await stat(`${configuredRoot}/${source.path}`);
    const sha256 = createHash("sha256").update(source.content).digest("hex");
    const prior = previous.get(source.path);
    return { path: source.path, mtimeMs: info.mtimeMs, sha256, status: prior && prior !== sha256 ? "stale" as const : "fresh" as const };
  }));
  const staleReasons = inputs.filter((item) => item.status === "stale").map((item) => `${item.path} content hash changed since previous evidence cache (sha256 mismatch)`);
  return {
    cacheKey: createHash("sha256").update(inputs.map((item) => `${item.path}:${item.sha256}`).join("|")).digest("hex"),
    inputs,
    outputs: ["repo_map", "legacy_repo_index", "business_logic_map", "traceability_matrix"],
    staleReasons,
    recommendedRescanTools: staleReasons.length > 0 ? ["legacy_repo_index", "repo_map", "business_logic_map"] : [],
  };
}
