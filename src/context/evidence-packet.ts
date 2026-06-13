import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { loadContextBundle } from "./context-loader.js";
import { resolveExistingPathInsideRoot, resolvePathInsideRoot } from "../state/path-safety.js";

export interface ContextPacketInput {
  readonly root: string;
  readonly targetPath?: string;
  readonly maxChars?: number;
  readonly evidenceRefs?: readonly string[];
  readonly notes?: readonly string[];
}

export interface ContextPacketEvidence {
  readonly ref: string;
  readonly file: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
}

export interface ContextPacket {
  readonly kind: "contextPacket";
  readonly root: string;
  readonly targetPath: string;
  readonly budget: { readonly maxChars: number };
  readonly documents: readonly { readonly path: string; readonly excerpt: string }[];
  readonly evidence: readonly ContextPacketEvidence[];
  readonly notes: readonly string[];
  readonly omitted: readonly string[];
  readonly truncated: boolean;
  readonly uncertainties: readonly string[];
}

const DEFAULT_MAX_CHARS = 6000;

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function parseRef(ref: string): { readonly file: string; readonly startLine: number; readonly endLine: number } {
  const match = /^(.+):(\d+)(?:-(\d+))?$/.exec(ref);
  if (!match?.[1] || !match[2]) throw new Error(`Invalid evidence ref: ${ref}`);
  const startLine = Number.parseInt(match[2], 10);
  const endLine = match[3] ? Number.parseInt(match[3], 10) : startLine;
  return { file: match[1], startLine, endLine: Math.max(startLine, endLine) };
}

async function evidence(root: string, ref: string): Promise<ContextPacketEvidence> {
  const parsed = parseRef(ref);
  const absolute = await resolveExistingPathInsideRoot(root, parsed.file);
  if (!absolute) throw new Error(`Evidence ref is outside configured root: ${ref}`);
  const text = await readFile(absolute, "utf8");
  const lines = text.split(/\r?\n/);
  const selected = lines.slice(parsed.startLine - 1, parsed.endLine).join("\n");
  return { ref, file: parsed.file, startLine: parsed.startLine, endLine: parsed.endLine, text: selected };
}

function trimText(text: string, maxChars: number): { readonly text: string; readonly truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, Math.max(0, maxChars - 16)), truncated: true };
}

export async function buildContextPacket(input: ContextPacketInput): Promise<ContextPacket> {
  const targetPath = input.targetPath ?? ".";
  const target = resolvePathInsideRoot(input.root, targetPath);
  if (!target) throw new Error(`Context packet target is outside configured root: ${targetPath}`);
  const info = await stat(target).catch(() => undefined);
  if (!info) throw new Error(`Context packet target is outside configured root: ${targetPath}`);
  const maxChars = positiveInteger(input.maxChars, DEFAULT_MAX_CHARS);
  const bundle = await loadContextBundle(input.root, targetPath);
  const evidenceItems = await Promise.all([...(input.evidenceRefs ?? [])].sort().map((ref) => evidence(input.root, ref)));
  let remaining = maxChars;
  const documents: { path: string; excerpt: string }[] = [];
  const omitted: string[] = [];
  let truncated = false;
  for (const document of bundle.documents) {
    const budget = Math.max(0, Math.min(remaining, Math.ceil(maxChars / 2)));
    const trimmed = trimText(document.content, budget);
    if (trimmed.text.length > 0) documents.push({ path: document.path, excerpt: trimmed.text });
    if (trimmed.truncated) {
      omitted.push(`${document.path}: truncated to packet budget`);
      truncated = true;
    }
    remaining -= trimmed.text.length;
    if (remaining <= 0) break;
  }
  const packet: ContextPacket = {
    kind: "contextPacket",
    root: path.basename(input.root),
    targetPath,
    budget: { maxChars },
    documents,
    evidence: evidenceItems,
    notes: input.notes ?? [],
    omitted,
    truncated: truncated || JSON.stringify({ documents, evidenceItems }).length > maxChars,
    uncertainties: evidenceItems.length === 0 ? ["No explicit evidence refs supplied."] : [],
  };
  return packet;
}
