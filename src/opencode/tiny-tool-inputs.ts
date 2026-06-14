import { readFile } from "node:fs/promises";
import { resolveTinyChuPaths } from "../state/paths.js";
import { resolveExistingPathInsideRoot } from "../state/path-safety.js";
import type { TaskStatus, TinyTask } from "../state/task-store.js";

export function stringInput(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Missing string input: ${key}`);
  return value;
}

export function stringListInput(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  return Array.isArray(value) ? value.map(String).filter((item) => item.trim() !== "") : [];
}

export function numberInput(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function taskStatusInput(value: unknown): TaskStatus | undefined {
  switch (value) {
    case "todo":
    case "in_progress":
    case "blocked":
    case "done":
    case "cancelled":
      return value;
    default:
      return undefined;
  }
}

export function taskPriorityInput(value: unknown): TinyTask["priority"] | undefined {
  switch (value) {
    case "low":
    case "normal":
    case "high":
      return value;
    default:
      return undefined;
  }
}

export function taskPatchInput(input: Record<string, unknown>): Partial<Omit<TinyTask, "id" | "createdAt">> {
  const patch: Partial<Omit<TinyTask, "id" | "createdAt">> = {};
  const status = taskStatusInput(input.status);
  const priority = taskPriorityInput(input.priority);
  if (typeof input.title === "string") patch.title = input.title;
  if (status) patch.status = status;
  if (priority) patch.priority = priority;
  if (Array.isArray(input.notes)) patch.notes = input.notes.map(String);
  if (typeof input.planRef === "string") patch.planRef = input.planRef;
  if (Array.isArray(input.evidenceRefs)) patch.evidenceRefs = input.evidenceRefs.map(String);
  if (Array.isArray(input.publicJobIds)) patch.publicJobIds = input.publicJobIds.map(String);
  return patch;
}

export function publicJobFormatInput(value: unknown): "markdown_sections" | "json" | undefined {
  if (value === undefined || value === "markdown_sections" || value === "json") return value;
  throw new Error(`Invalid public job format: ${String(value)}`);
}

export async function markdownInput(root: string | undefined, input: Record<string, unknown>): Promise<string> {
  if (typeof input.markdown === "string") return input.markdown;
  if (typeof input.path === "string" && input.path.trim() !== "") {
    const configuredRoot = resolveTinyChuPaths(root).root;
    const absolute = await resolveExistingPathInsideRoot(configuredRoot, input.path);
    if (!absolute) throw new Error(`Mermaid path is outside configured root: ${input.path}`);
    return readFile(absolute, "utf8");
  }
  throw new Error("Missing markdown or path input");
}
