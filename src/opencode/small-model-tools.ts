import { readFile } from "node:fs/promises";
import { portableRelative, resolveExistingPathInsideRoot } from "../state/path-safety.js";
import type { TaskCheckpoint, TinyTask } from "../state/task-store.js";

export interface ContextSnippet {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export interface ContextDigestResult {
  readonly query: string;
  readonly snippets: readonly ContextSnippet[];
  readonly citations: readonly string[];
  readonly truncated: boolean;
}

export interface WriteChunk {
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface ChunkedWritePlanResult {
  readonly path: string;
  readonly totalChars: number;
  readonly maxChunkChars: number;
  readonly chunks: readonly WriteChunk[];
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Missing string input: ${name}`);
  return value;
}

function truncate(line: string, maxChars: number): string {
  return line.length <= maxChars ? line : line.slice(0, maxChars);
}

export async function createContextDigest(root: string, input: Record<string, unknown>): Promise<ContextDigestResult> {
  const targetPath = requiredText(input.targetPath, "targetPath");
  const query = requiredText(input.query, "query");
  const maxSnippetChars = positiveInteger(input.maxSnippetChars, 160);
  const maxSnippets = positiveInteger(input.maxSnippets, 12);
  const absolute = await resolveExistingPathInsideRoot(root, targetPath);
  if (!absolute) throw new Error(`Context digest path is outside configured root: ${targetPath}`);
  const resolvedTarget = await resolveExistingPathInsideRoot(root, ".");
  const relative = portableRelative(resolvedTarget ?? root, absolute);
  const lines = (await readFile(absolute, "utf8")).split(/\r?\n/);
  const snippets: ContextSnippet[] = [];
  for (const [index, line] of lines.entries()) {
    if (!line.includes(query)) continue;
    snippets.push({ file: relative, line: index + 1, text: truncate(line.trim(), maxSnippetChars) });
    if (snippets.length >= maxSnippets) break;
  }
  return {
    query,
    snippets,
    citations: snippets.map((snippet) => `${snippet.file}:${snippet.line}`),
    truncated: lines.filter((line) => line.includes(query)).length > snippets.length,
  };
}

function latestCheckpoint(task: TinyTask): TaskCheckpoint | undefined {
  return task.checkpoints.at(-1);
}

export function createResumePacket(task: TinyTask): {
  readonly activeGoal: { readonly id: string; readonly title: string; readonly status: TinyTask["status"]; readonly priority: TinyTask["priority"] };
  readonly latestCheckpoint?: TaskCheckpoint;
  readonly nextSteps: readonly string[];
  readonly openQuestions: readonly string[];
  readonly evidenceRefs: readonly string[];
} {
  const checkpoint = latestCheckpoint(task);
  return {
    activeGoal: { id: task.id, title: task.title, status: task.status, priority: task.priority },
    ...(checkpoint === undefined ? {} : { latestCheckpoint: checkpoint }),
    nextSteps: checkpoint?.nextSteps ?? [],
    openQuestions: checkpoint?.openQuestions ?? [],
    evidenceRefs: [...new Set([...task.evidenceRefs, ...(checkpoint?.evidenceRefs ?? [])])].sort(),
  };
}

export function createChunkedWritePlan(input: Record<string, unknown>): ChunkedWritePlanResult {
  const targetPath = requiredText(input.path, "path");
  const markdown = requiredText(input.markdown, "markdown");
  const maxChunkChars = positiveInteger(input.maxChunkChars, 2000);
  const chunks: WriteChunk[] = [];
  for (let start = 0; start < markdown.length;) {
    const maxEnd = Math.min(start + maxChunkChars, markdown.length);
    const newlineIndex = maxEnd < markdown.length ? markdown.lastIndexOf("\n", maxEnd - 1) : -1;
    const end = newlineIndex >= start ? newlineIndex + 1 : maxEnd;
    const text = markdown.slice(start, end);
    chunks.push({ index: chunks.length + 1, start, end: start + text.length, text });
    start = end;
  }
  return { path: targetPath, totalChars: markdown.length, maxChunkChars, chunks };
}
