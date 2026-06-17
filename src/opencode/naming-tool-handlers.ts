import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { checkNamingDictionary, type NamingCandidate } from "../naming/naming-check.js";
import { createNamingContext } from "../naming/naming-context.js";
import { parseNamingDictionary } from "../naming/naming-dictionary.js";
import { normalizedNamingLookupKey } from "../naming/naming-normalize.js";
import { appendNamingProposalEvent, readNamingEvents } from "../naming/naming-storage.js";
import type { NamingEntryKind, NamingNamespace } from "../naming/naming-types.js";
import { resolveTinyChuPaths } from "../state/paths.js";
import { numberInput, stringInput, stringListInput } from "./tiny-tool-inputs.js";
import type { TinyToolHandler } from "./tiny-plugin-types.js";

const ENTRY_KINDS = new Set<NamingEntryKind>(["class", "constant", "function", "interface", "method", "setting", "term", "tool", "type", "variable"]);
const NAMESPACES = new Set<NamingNamespace>(["context", "dispatcher", "model-settings", "opencode", "shared", "state", "ulw-loop", "wiki", "workflow"]);

export function createNamingToolHandlers(root: string | undefined): Record<string, TinyToolHandler> {
  return {
    naming_lookup: async (input) => createNamingContext({ root: resolveTinyChuPaths(root).root, query: stringInput(input, "query"), namespace: optionalNamespace(input.namespace), kind: optionalKind(input.kind), maxEntries: numberInput(input, "maxEntries") }),
    naming_context: async (input) => createNamingContext({ root: resolveTinyChuPaths(root).root, query: stringInput(input, "query"), namespace: optionalNamespace(input.namespace), kind: optionalKind(input.kind), maxEntries: numberInput(input, "maxEntries"), format: input.format === "markdown" ? "markdown" : "json" }),
    naming_propose: async (input) => proposeNaming(root, input, false),
    naming_add: async (input) => proposeNaming(root, input, true),
  };
}

async function proposeNaming(root: string | undefined, input: Record<string, unknown>, persist: boolean): Promise<Record<string, unknown>> {
  const candidate = candidateFromInput(input);
  const normalized = normalizedNamingLookupKey(candidate.name);
  const dictionary = await readDictionary(root);
  const check = checkNamingDictionary({ dictionary, candidate });
  const id = proposalId(candidate, normalized);
  const existing = persist ? (await readNamingEvents(root)).some((event) => event.id === id) : false;
  const status = existing ? "duplicate" : "pending";
  const result = { id, normalized, status, diagnostics: check.diagnostics, candidate };
  if (persist) {
    await appendNamingProposalEvent(root, {
      id,
      createdAt: new Date().toISOString(),
      action: "propose",
      candidate,
      normalized,
      status,
      diagnostics: check.diagnostics,
    });
  }
  return result;
}

function candidateFromInput(input: Record<string, unknown>): NamingCandidate {
  return {
    name: stringInput(input, "name"),
    kind: requiredKind(input.kind),
    namespace: requiredNamespace(input.namespace),
    meaning: typeof input.meaning === "string" ? input.meaning : undefined,
    sourceRefs: stringListInput(input, "sourceRefs"),
  };
}

async function readDictionary(root: string | undefined): Promise<unknown> {
  return parseNamingDictionary(await readFile(path.join(resolveTinyChuPaths(root).root, "docs", "naming", "dictionary.json"), "utf8"), "docs/naming/dictionary.json");
}

function proposalId(candidate: NamingCandidate, normalized: string): string {
  return createHash("sha256").update(`${candidate.namespace}\0${candidate.kind}\0${normalized}\0${candidate.meaning ?? ""}`).digest("hex");
}

function optionalKind(value: unknown): NamingEntryKind | undefined {
  if (value === undefined) return undefined;
  return requiredKind(value);
}

function optionalNamespace(value: unknown): NamingNamespace | undefined {
  if (value === undefined) return undefined;
  return requiredNamespace(value);
}

function requiredKind(value: unknown): NamingEntryKind {
  if (typeof value === "string" && ENTRY_KINDS.has(value as NamingEntryKind)) return value as NamingEntryKind;
  throw new Error(`Invalid naming kind: ${String(value)}`);
}

function requiredNamespace(value: unknown): NamingNamespace {
  if (typeof value === "string" && NAMESPACES.has(value as NamingNamespace)) return value as NamingNamespace;
  throw new Error(`Invalid naming namespace: ${String(value)}`);
}
