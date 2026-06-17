import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveTinyChuPaths } from "../state/paths.js";
import {
  NamingDictionaryReadError,
  type NamingCasing,
  type NamingDiagnosticCode,
  type NamingDictionary,
  type NamingDictionaryDiagnostic,
  type NamingEntry,
  type NamingEntryKind,
  type NamingEntryStatus,
  type NamingNamespace,
} from "./naming-types.js";

type JsonRecord = { readonly [key: string]: unknown };

const REQUIRED_ENTRY_FIELDS = [
  "id",
  "name",
  "normalized",
  "kind",
  "namespace",
  "casing",
  "tokens",
  "status",
  "collisionGroup",
  "aliases",
  "blockedVariants",
  "sourceRefs",
  "meaning",
] as const;

export function parseNamingDictionary(input: unknown, file = "naming dictionary"): NamingDictionary {
  const diagnostics: NamingDictionaryDiagnostic[] = [];
  const parsed = typeof input === "string" ? parseJson(input, file, diagnostics) : input;
  if (!isRecord(parsed)) {
    diagnostics.push(diagnostic("invalid_field_type", "", "Naming dictionary must be an object."));
    throwIfDiagnostics(file, diagnostics);
    return { schemaVersion: 1, entries: [] };
  }

  for (const key of Object.keys(parsed).sort()) {
    if (key !== "schemaVersion" && key !== "entries") diagnostics.push(diagnostic("unknown_field", key, `${key} is not a supported dictionary field.`));
  }
  if (parsed["schemaVersion"] !== 1) diagnostics.push(diagnostic("invalid_field_value", "schemaVersion", "schemaVersion must be 1."));
  const rawEntries = parsed["entries"];
  if (!Array.isArray(rawEntries)) diagnostics.push(diagnostic("invalid_field_type", "entries", "entries must be an array."));
  if (diagnostics.length > 0) throwIfDiagnostics(file, diagnostics);

  const entries = Array.isArray(rawEntries) ? parseEntries(rawEntries, diagnostics) : [];
  const seenIds = new Set<string>();
  for (const entry of entries) {
    if (seenIds.has(entry.id)) diagnostics.push(diagnostic("duplicate_entry_id", `entries.${entry.id}`, `Duplicate naming entry id: ${entry.id}.`));
    seenIds.add(entry.id);
  }
  throwIfDiagnostics(file, diagnostics);
  return { schemaVersion: 1, entries: sortedEntries(entries) };
}

export async function loadNamingDictionary(root?: string): Promise<NamingDictionary> {
  const file = path.join(resolveTinyChuPaths(root).root, "docs", "naming", "dictionary.json");
  return parseNamingDictionary(await readFile(file, "utf8"), file);
}

function parseEntries(values: readonly unknown[], diagnostics: NamingDictionaryDiagnostic[]): readonly NamingEntry[] {
  const entries: NamingEntry[] = [];
  values.forEach((value, index) => {
    const parsed = parseEntry(value, `entries[${index}]`, diagnostics);
    if (parsed !== undefined) entries.push(parsed);
  });
  return entries;
}

function parseEntry(value: unknown, pathPrefix: string, diagnostics: NamingDictionaryDiagnostic[]): NamingEntry | undefined {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic("invalid_field_type", pathPrefix, "Naming entry must be an object."));
    return undefined;
  }

  for (const key of Object.keys(value).sort()) {
    if (!isEntryField(key)) diagnostics.push(diagnostic("unknown_field", `${pathPrefix}.${key}`, `${key} is not a supported entry field.`));
  }
  for (const field of REQUIRED_ENTRY_FIELDS) {
    if (value[field] === undefined) diagnostics.push(diagnostic("missing_required_field", `${pathPrefix}.${field}`, `${field} is required.`));
  }
  if (diagnostics.some((item) => item.path.startsWith(`${pathPrefix}.`))) return undefined;

  const id = requiredString(value, "id", pathPrefix, diagnostics);
  const name = requiredString(value, "name", pathPrefix, diagnostics);
  const normalized = requiredString(value, "normalized", pathPrefix, diagnostics);
  const kind = parseKind(value["kind"], `${pathPrefix}.kind`, diagnostics);
  const namespace = parseNamespace(value["namespace"], `${pathPrefix}.namespace`, diagnostics);
  const casing = parseCasing(value["casing"], `${pathPrefix}.casing`, diagnostics);
  const tokens = requiredStringArray(value, "tokens", pathPrefix, true, diagnostics);
  const status = parseStatus(value["status"], `${pathPrefix}.status`, diagnostics);
  const collisionGroup = requiredString(value, "collisionGroup", pathPrefix, diagnostics);
  const aliases = requiredStringArray(value, "aliases", pathPrefix, false, diagnostics);
  const blockedVariants = requiredStringArray(value, "blockedVariants", pathPrefix, false, diagnostics);
  const sourceRefs = requiredStringArray(value, "sourceRefs", pathPrefix, true, diagnostics);
  const meaning = requiredString(value, "meaning", pathPrefix, diagnostics);

  if (name !== undefined && normalized !== undefined && normalizeName(name) !== normalized) {
    diagnostics.push(diagnostic("invalid_field_value", `${pathPrefix}.normalized`, "normalized must match lowercase alphanumeric name normalization."));
  }
  if (diagnostics.some((item) => item.path.startsWith(`${pathPrefix}.`))) return undefined;
  if (id === undefined || name === undefined || normalized === undefined || kind === undefined || namespace === undefined || casing === undefined || tokens === undefined || status === undefined || collisionGroup === undefined || aliases === undefined || blockedVariants === undefined || sourceRefs === undefined || meaning === undefined) return undefined;

  return { id, name, normalized, kind, namespace, casing, tokens, status, collisionGroup, aliases, blockedVariants, sourceRefs, meaning };
}

function parseJson(raw: string, file: string, diagnostics: NamingDictionaryDiagnostic[]): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) {
      diagnostics.push(diagnostic("malformed_json", "", "Dictionary JSON could not be parsed."));
      throw new NamingDictionaryReadError(file, diagnostics, { cause: error });
    }
    throw error;
  }
}

function requiredString(record: JsonRecord, key: string, pathPrefix: string, diagnostics: NamingDictionaryDiagnostic[]): string | undefined {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    diagnostics.push(diagnostic("invalid_field_type", `${pathPrefix}.${key}`, `${key} must be a non-empty string.`));
    return undefined;
  }
  return value;
}

function requiredStringArray(record: JsonRecord, key: string, pathPrefix: string, requireItem: boolean, diagnostics: NamingDictionaryDiagnostic[]): readonly string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value) || (requireItem && value.length === 0)) {
    diagnostics.push(diagnostic("invalid_field_type", `${pathPrefix}.${key}`, `${key} must be a string array${requireItem ? " with at least one item" : ""}.`));
    return undefined;
  }
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      diagnostics.push(diagnostic("invalid_field_type", `${pathPrefix}.${key}`, `${key} must be a string array${requireItem ? " with at least one item" : ""}.`));
      return undefined;
    }
    items.push(item);
  }
  return items;
}

function parseKind(value: unknown, path: string, diagnostics: NamingDictionaryDiagnostic[]): NamingEntryKind | undefined {
  if (typeof value !== "string") return invalidLiteral(path, "kind", diagnostics);
  switch (value) {
    case "class":
    case "constant":
    case "function":
    case "interface":
    case "method":
    case "setting":
    case "term":
    case "tool":
    case "type":
    case "variable":
      return value;
  }
  return invalidLiteral(path, "kind", diagnostics);
}

function parseNamespace(value: unknown, path: string, diagnostics: NamingDictionaryDiagnostic[]): NamingNamespace | undefined {
  if (typeof value !== "string") return invalidLiteral(path, "namespace", diagnostics);
  switch (value) {
    case "context":
    case "dispatcher":
    case "model-settings":
    case "opencode":
    case "shared":
    case "state":
    case "ulw-loop":
    case "wiki":
    case "workflow":
      return value;
  }
  return invalidLiteral(path, "namespace", diagnostics);
}

function parseCasing(value: unknown, path: string, diagnostics: NamingDictionaryDiagnostic[]): NamingCasing | undefined {
  if (typeof value !== "string") return invalidLiteral(path, "casing", diagnostics);
  switch (value) {
    case "camelCase":
    case "lowerCase":
    case "PascalCase":
    case "SCREAMING_SNAKE_CASE":
    case "snake_case":
      return value;
  }
  return invalidLiteral(path, "casing", diagnostics);
}

function parseStatus(value: unknown, path: string, diagnostics: NamingDictionaryDiagnostic[]): NamingEntryStatus | undefined {
  if (typeof value !== "string") return invalidLiteral(path, "status", diagnostics);
  switch (value) {
    case "active":
    case "blocked":
    case "deprecated":
    case "reserved":
      return value;
  }
  return invalidLiteral(path, "status", diagnostics);
}

function invalidLiteral(path: string, field: string, diagnostics: NamingDictionaryDiagnostic[]): undefined {
  diagnostics.push(diagnostic("invalid_field_value", path, `${field} has an unsupported value.`));
  return undefined;
}

function normalizeName(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function compareEntries(left: NamingEntry, right: NamingEntry): number {
  return left.id.localeCompare(right.id);
}

function isEntryField(key: string): boolean {
  switch (key) {
    case "aliases":
    case "blockedVariants":
    case "casing":
    case "collisionGroup":
    case "id":
    case "kind":
    case "meaning":
    case "name":
    case "namespace":
    case "normalized":
    case "sourceRefs":
    case "status":
    case "tokens":
      return true;
  }
  return false;
}

function sortedEntries(entries: readonly NamingEntry[]): readonly NamingEntry[] {
  return [...entries].sort(compareEntries);
}

function throwIfDiagnostics(file: string, diagnostics: readonly NamingDictionaryDiagnostic[]): void {
  if (diagnostics.length > 0) throw new NamingDictionaryReadError(file, [...diagnostics].sort(compareDiagnostics));
}

function compareDiagnostics(left: NamingDictionaryDiagnostic, right: NamingDictionaryDiagnostic): number {
  return left.path.localeCompare(right.path) || left.code.localeCompare(right.code);
}

function diagnostic(code: NamingDiagnosticCode, path: string, message: string): NamingDictionaryDiagnostic {
  return { code, severity: "error", path, message };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
