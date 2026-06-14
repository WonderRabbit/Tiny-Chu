import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolveExistingPathInsideRoot, resolvePathInsideRoot } from "../state/path-safety.js";
import { nestedRecord, recordsInput, stringField } from "./legacy-input.js";
import { bounded, type EvidenceStatus } from "./extension-scan.js";
import { uxSourceFingerprint, type LayoutTruthRecord, type UxRationaleText } from "./ux-reverse-analysis.js";
import { ensureSafeUxTarget, relativeToRoot, truthJsonPath } from "./layout-truth-paths.js";
import { renderLayoutTruthReport } from "./layout-truth-report.js";

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

async function writeRecords(root: string, filePath: string, records: readonly LayoutTruthRecord[]): Promise<void> {
  await ensureSafeUxTarget(root, filePath);
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

function isUnsupportedVerifiedPosition(rationale: UxRationaleText): boolean {
  if (rationale.status !== "Verified") return false;
  const sourceOrderReason = /\bsource[-\s]*order\b|\bappears?\s+(?:before|after)\b|\b(?:jsx|tsx|source|markup)\b.*\bfirst\b|\bfirst\b.*\b(?:jsx|tsx|source|markup)\b/i.test(rationale.reason);
  const conventionReason = /\bconvention(?:al|s)?\b|\b(?:normally|usually|typically|standard|customary|traditional)\b/i.test(rationale.reason);
  return sourceOrderReason || conventionReason;
}

function demoteUnsupportedVerifiedPosition(record: LayoutTruthRecord): LayoutTruthRecord {
  if (!isUnsupportedVerifiedPosition(record.positionRationale)) return record;
  const positionRationale: UxRationaleText = {
    ...record.positionRationale,
    status: "Needs Verification",
    reason: `${record.positionRationale.reason} Source-order-only or convention-only position rationale cannot be Verified without direct layout or cross-layer evidence.`,
  };
  return { ...record, positionRationale, lifecycle: "needs_review" };
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
  const match = evidenceRef.match(/^([\s\S]+):(\d+)$/);
  if (!match?.[1] || !match[2]) return undefined;
  const absolute = await resolveExistingPathInsideRoot(root, match[1]).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!absolute) return undefined;
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
  await ensureSafeUxTarget(root, filePath);
  const rejected: string[] = [];
  const current = new Map<string, LayoutTruthRecord>();
  for (const existing of await readRecords(filePath)) {
    const record = demoteUnsupportedVerifiedPosition(existing);
    if (!await currentFingerprint(root, record)) {
      rejected.push(`existing record missing evidence-backed fingerprint for ${record.truthId}`);
      continue;
    }
    current.set(record.truthId, record);
  }
  for (const record of recordsInput(input.records)) {
    const normalized = normalize(record);
    if (!normalized) {
      rejected.push("missing truthId or elementName");
      continue;
    }
    const incoming = demoteUnsupportedVerifiedPosition({ ...normalized, lifecycle: normalized.lifecycle === "candidate" ? "needs_review" : normalized.lifecycle });
    const merged = demoteUnsupportedVerifiedPosition(mergeRecord(current.get(normalized.truthId), incoming));
    const refreshed = await currentFingerprint(root, merged);
    if (!refreshed) {
      rejected.push(`missing evidence-backed fingerprint for ${normalized.truthId}`);
      continue;
    }
    current.set(normalized.truthId, { ...merged, sourceFingerprint: refreshed });
  }
  const records = bounded([...current.values()].sort((left, right) => left.truthId.localeCompare(right.truthId)), input.maxRecords, 200);
  await writeRecords(root, filePath, records);
  return { path: relativeToRoot(root, filePath), records, rejected };
}

export async function verifyLayoutTruth(root: string, input: Record<string, unknown>): Promise<LayoutTruthVerifyResult> {
  const filePath = truthJsonPath(root, input.path);
  await ensureSafeUxTarget(root, filePath);
  const records = await readRecords(filePath);
  const verified: LayoutTruthRecord[] = [];
  const stale: LayoutTruthRecord[] = [];
  const missing: LayoutTruthRecord[] = [];
  for (const record of records) {
    const normalized = demoteUnsupportedVerifiedPosition(record);
    const unsupported = normalized.positionRationale.status !== record.positionRationale.status;
    const current = await currentFingerprint(root, normalized);
    if (!current || unsupported) missing.push({ ...normalized, lifecycle: "needs_review" });
    else if (current === normalized.sourceFingerprint) verified.push({ ...normalized, lifecycle: "verified" });
    else stale.push({ ...normalized, lifecycle: "stale" });
  }
  const verificationPath = resolvePathInsideRoot(root, `.tiny/ux/verification/${Date.now()}.json`);
  if (!verificationPath) throw new Error("Layout truth verification path is outside configured root");
  const result = { path: relativeToRoot(root, filePath), verified, stale, missing, reviewTargets: [...stale, ...missing], verificationPath: relativeToRoot(root, verificationPath) };
  await ensureSafeUxTarget(root, verificationPath);
  await writeFile(verificationPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

export async function reportLayoutTruth(root: string, input: Record<string, unknown>): Promise<LayoutTruthReportResult> {
  const filePath = truthJsonPath(root, input.path);
  const verification = await verifyLayoutTruth(root, input);
  const records = [...verification.verified, ...verification.stale, ...verification.missing].sort((left, right) => left.truthId.localeCompare(right.truthId));
  const rendered = renderLayoutTruthReport(root, filePath, verification, records);
  await ensureSafeUxTarget(root, rendered.markdownPath);
  await writeFile(rendered.markdownPath, `${rendered.markdown}\n`, "utf8");
  return { path: relativeToRoot(root, filePath), markdownPath: rendered.markdownPathRelative, markdown: rendered.markdown, evidenceRefs: rendered.evidenceRefs };
}
