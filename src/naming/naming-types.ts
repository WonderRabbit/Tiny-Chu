export type NamingEntryKind = "class" | "constant" | "function" | "interface" | "method" | "setting" | "term" | "tool" | "type" | "variable";
export type NamingNamespace = "context" | "dispatcher" | "model-settings" | "opencode" | "shared" | "state" | "ulw-loop" | "wiki" | "workflow";
export type NamingCasing = "camelCase" | "lowerCase" | "PascalCase" | "SCREAMING_SNAKE_CASE" | "snake_case";
export type NamingEntryStatus = "active" | "blocked" | "deprecated" | "reserved";
export type NamingDiagnosticCode = "duplicate_entry_id" | "invalid_field_type" | "invalid_field_value" | "malformed_json" | "missing_required_field" | "unknown_field";

export interface NamingEntry {
  readonly id: string;
  readonly name: string;
  readonly normalized: string;
  readonly kind: NamingEntryKind;
  readonly namespace: NamingNamespace;
  readonly casing: NamingCasing;
  readonly tokens: readonly string[];
  readonly status: NamingEntryStatus;
  readonly collisionGroup: string;
  readonly aliases: readonly string[];
  readonly blockedVariants: readonly string[];
  readonly sourceRefs: readonly string[];
  readonly meaning: string;
}

export interface NamingDictionary {
  readonly schemaVersion: 1;
  readonly entries: readonly NamingEntry[];
}

export interface NamingDictionaryDiagnostic {
  readonly code: NamingDiagnosticCode;
  readonly severity: "error";
  readonly path: string;
  readonly message: string;
}

export class NamingDictionaryReadError extends Error {
  readonly name = "NamingDictionaryReadError";

  constructor(readonly file: string, readonly diagnostics: readonly NamingDictionaryDiagnostic[], options?: ErrorOptions) {
    super(`Malformed naming dictionary: ${file}`, options);
  }
}
