import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolvePathInsideRoot } from "../state/path-safety.js";
import { nestedRecord, recordsInput, stringField } from "./legacy-input.js";
import { bounded, type EvidenceStatus } from "./extension-scan.js";
import { uxSourceFingerprint, type LayoutTruthRecord, type UxRationaleText } from "./ux-reverse-analysis.js";

export interface LayoutTruthUpdateResult {
  readonly path: string;
  readonly records: readonly LayoutTruthRecord[];
  readonly rejected: readonly string[];
}

export interface LayoutTruthVerifyResult {
  readonly path: string;
  readonly verified: readonly LayoutTruthRecord[];
  readonly stale: readonly LayoutTruthRecord[];
  readonly missing: readonly LayoutTruthRecord[];
  readonly reviewTargets: readonly LayoutTruthRecord[];
  readonly verificationPath: string;
}

export interface LayoutTruthReportResult {
  readonly path: string;
  readonly markdownPath: string;
  readonly markdown: string;
  readonly evidenceRefs: readonly string[];
}

function truthJsonPath(root: string, candidate?: unknown): string {
  const relative = typeof candidate === "string" && candidate.trim() !== "" ? candidate : ".tiny/ux/layout-truth.json";
  const resolved = resolvePathInsideRoot(root, relative);
  if (!resolved) throw new Error(`Layout truth path is outside configured root: ${relative}`);
  const uxRoot = resolvePathInsideRoot(root, ".tiny/ux");
  if (!uxRoot) throw new Error("Layout truth root is outside configured root");
  const fromUx = path.relative(uxRoot, resolved);
  if (fromUx === ".." || fromUx.startsWith("../") || fromUx.startsWith("..\\")) {
    throw new Error(`Layout truth path is outside .tiny/ux: ${relative}`);
  }
  return resolved;
}

function relativeToRoot(root: string, absolute: string): string {
  return path.relative(root, absolute).replace(/\\/g, "/");
}

function statusRank(status: EvidenceStatus): number {
  switch (status) {
    case "Verified": return 3;
    case "Inferred": return 2;
    case "Needs Verification": return 1;
    case "Unknown": return 0;
  }
}

function status(value: unknown): EvidenceStatus {
  return value === "Verified" || value === "Inferred" || value === "Needs Verification" || value === "Unknown" ? value : "Unknown";
}

function rationale(value: unknown): UxRationaleText {
  const record = nestedRecord({ value }, "value");
  const refs = Array.isArray(record.evidenceRefs) ? record.evidenceRefs.map(String) : [];
  return { status: status(record.status), reason: stringField(record, "reason", "Unknown"), evidenceRefs: refs };
}

function lifecycle(value: unknown): LayoutTruthRecord["lifecycle"] {
  return value === "candidate" || value === "verified" || value === "stale" || value === "needs_review" || value === "superseded" || value === "rejected" ? value : "needs_review";
}

function normalize(value: unknown): LayoutTruthRecord | undefined {
  const record = recordsInput([value])[0];
  if (!record) return undefined;
  const truthId = stringField(record, "truthId");
  const elementName = stringField(record, "elementName");
  if (truthId === "" || elementName === "") return undefined;
  const refs = Array.isArray(record.evidenceRefs) ? record.evidenceRefs.map(String) : [];
  return {
    truthId,
    screenId: stringField(record, "screenId", "Unknown"),
    elementId: stringField(record, "elementId", truthId),
    elementName,
    area: record.area === "search_condition" || record.area === "result_field" || record.area === "action_control" || record.area === "message" || record.area === "unknown" ? record.area : "unknown",
    existenceRationale: rationale(record.existenceRationale),
    positionRationale: rationale(record.positionRationale),
    validationRationale: rationale(record.validationRationale),
    messageRationale: rationale(record.messageRationale),
    sourceFingerprint: stringField(record, "sourceFingerprint"),
    evidenceRefs: refs,
    lifecycle: lifecycle(record.lifecycle),
    version: typeof record.version === "number" ? record.version : 1,
  };
}

async function readRecords(filePath: string): Promise<readonly LayoutTruthRecord[]> {
  if (!existsSync(filePath)) return [];
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  return recordsInput(parsed).flatMap((item) => {
    const normalized = normalize(item);
    return normalized ? [normalized] : [];
  });
}

async function writeRecords(filePath: string, records: readonly LayoutTruthRecord[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

function stronger(existing: UxRationaleText, incoming: UxRationaleText): UxRationaleText {
  return statusRank(incoming.status) >= statusRank(existing.status) ? incoming : existing;
}

function uniqueRefs(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim() !== ""))].sort();
}

function recordEvidenceRefs(record: LayoutTruthRecord): readonly string[] {
  return uniqueRefs([
    ...record.evidenceRefs,
    ...record.existenceRationale.evidenceRefs,
    ...record.positionRationale.evidenceRefs,
    ...record.validationRationale.evidenceRefs,
    ...record.messageRationale.evidenceRefs,
  ]);
}

function mergeRecord(existing: LayoutTruthRecord | undefined, incoming: LayoutTruthRecord): LayoutTruthRecord {
  if (!existing) return { ...incoming, lifecycle: incoming.lifecycle === "candidate" ? "needs_review" : incoming.lifecycle };
  const existenceRationale = stronger(existing.existenceRationale, incoming.existenceRationale);
  const positionRationale = stronger(existing.positionRationale, incoming.positionRationale);
  const validationRationale = stronger(existing.validationRationale, incoming.validationRationale);
  const messageRationale = stronger(existing.messageRationale, incoming.messageRationale);
  return {
    ...incoming,
    existenceRationale,
    positionRationale,
    validationRationale,
    messageRationale,
    evidenceRefs: uniqueRefs([...recordEvidenceRefs(existing), ...recordEvidenceRefs(incoming), ...existenceRationale.evidenceRefs, ...positionRationale.evidenceRefs, ...validationRationale.evidenceRefs, ...messageRationale.evidenceRefs]),
    lifecycle: statusRank(incoming.existenceRationale.status) >= statusRank(existing.existenceRationale.status) ? incoming.lifecycle : existing.lifecycle,
    version: existing.version + 1,
  };
}

async function fingerprintForRef(root: string, evidenceRef: string): Promise<string | undefined> {
  const match = evidenceRef.match(/^(.+):(\d+)$/);
  if (!match?.[1] || !match[2]) return undefined;
  const absolute = resolvePathInsideRoot(root, match[1]);
  if (!absolute || !existsSync(absolute)) return undefined;
  const lineNumber = Number.parseInt(match[2], 10);
  const lines = (await readFile(absolute, "utf8")).split(/\r?\n/);
  const text = lines[lineNumber - 1];
  return text === undefined ? undefined : uxSourceFingerprint(match[1], lineNumber, text);
}

async function currentFingerprint(root: string, record: LayoutTruthRecord): Promise<string | undefined> {
  const fingerprints: string[] = [];
  for (const ref of recordEvidenceRefs(record)) {
    const fingerprint = await fingerprintForRef(root, ref);
    if (!fingerprint) return undefined;
    fingerprints.push(`${ref}=${fingerprint}`);
  }
  return fingerprints.length === 0 ? undefined : fingerprints.join("|");
}

export async function updateLayoutTruth(root: string, input: Record<string, unknown>): Promise<LayoutTruthUpdateResult> {
  const filePath = truthJsonPath(root, input.path);
  const current = new Map((await readRecords(filePath)).map((record) => [record.truthId, record]));
  const rejected: string[] = [];
  for (const record of recordsInput(input.records)) {
    const normalized = normalize(record);
    if (!normalized) {
      rejected.push("missing truthId or elementName");
      continue;
    }
    const incoming = { ...normalized, lifecycle: normalized.lifecycle === "candidate" ? "needs_review" : normalized.lifecycle };
    const merged = mergeRecord(current.get(normalized.truthId), incoming);
    const refreshed = await currentFingerprint(root, merged);
    current.set(normalized.truthId, { ...merged, sourceFingerprint: refreshed ?? merged.sourceFingerprint });
  }
  const records = bounded([...current.values()].sort((left, right) => left.truthId.localeCompare(right.truthId)), input.maxRecords, 200);
  await writeRecords(filePath, records);
  return { path: relativeToRoot(root, filePath), records, rejected };
}

export async function verifyLayoutTruth(root: string, input: Record<string, unknown>): Promise<LayoutTruthVerifyResult> {
  const filePath = truthJsonPath(root, input.path);
  const records = await readRecords(filePath);
  const verified: LayoutTruthRecord[] = [];
  const stale: LayoutTruthRecord[] = [];
  const missing: LayoutTruthRecord[] = [];
  for (const record of records) {
    const current = await currentFingerprint(root, record);
    if (!current) missing.push({ ...record, lifecycle: "needs_review" });
    else if (current === record.sourceFingerprint) verified.push({ ...record, lifecycle: "verified" });
    else stale.push({ ...record, lifecycle: "stale" });
  }
  const verificationPath = resolvePathInsideRoot(root, `.tiny/ux/verification/${Date.now()}.json`);
  if (!verificationPath) throw new Error("Layout truth verification path is outside configured root");
  const result = { path: relativeToRoot(root, filePath), verified, stale, missing, reviewTargets: [...stale, ...missing], verificationPath: relativeToRoot(root, verificationPath) };
  await mkdir(path.dirname(verificationPath), { recursive: true });
  await writeFile(verificationPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

export async function reportLayoutTruth(root: string, input: Record<string, unknown>): Promise<LayoutTruthReportResult> {
  const filePath = truthJsonPath(root, input.path);
  const verification = await verifyLayoutTruth(root, input);
  const records = [...verification.verified, ...verification.stale, ...verification.missing].sort((left, right) => left.truthId.localeCompare(right.truthId));
  const markdownPath = resolvePathInsideRoot(root, ".tiny/ux/layout-truth.md");
  if (!markdownPath) throw new Error("Layout truth report path is outside configured root");
  const evidenceRefs = records.flatMap((record) => record.evidenceRefs);
  const reviewTargets = verification.reviewTargets.length > 0 ? verification.reviewTargets.map((record) => `- ${record.elementName}: ${record.lifecycle}`) : ["- None"];
  const staleCommands = verification.stale.length > 0 ? verification.stale.map((record) => `- ${record.elementName}: rg -n "${record.elementName}" ${record.evidenceRefs.map((ref) => ref.replace(/:\d+$/, "")).join(" ")}`) : ["- None"];
  const markdown = [
    "# Layout Truth",
    "",
    `Source: ${relativeToRoot(root, filePath)}`,
    `Verified: ${verification.verified.length}`,
    `Stale: ${verification.stale.length}`,
    `Unknown/Missing: ${verification.missing.length}`,
    "",
    "| Truth ID | Element | Lifecycle | Existence | Position | Evidence |",
    "| --- | --- | --- | --- | --- | --- |",
    ...records.map((record) => `| ${record.truthId} | ${record.elementName} | ${record.lifecycle} | ${record.existenceRationale.status} | ${record.positionRationale.status} | ${record.evidenceRefs.join(", ")} |`),
    "",
    "## Review Targets",
    ...reviewTargets,
    "## Stale Evidence Commands",
    ...staleCommands,
    "## Rule Candidates",
    ...records.map((record) => `- ${record.elementName}: existence=${record.existenceRationale.status}; position=${record.positionRationale.status}; validation=${record.validationRationale.status}; message=${record.messageRationale.status}`),
  ].join("\n");
  await mkdir(path.dirname(markdownPath), { recursive: true });
  await writeFile(markdownPath, `${markdown}\n`, "utf8");
  return { path: relativeToRoot(root, filePath), markdownPath: relativeToRoot(root, markdownPath), markdown, evidenceRefs };
}
