import { exactNamingLookupKey, normalizedNamingLookupKey, normalizedNamingToken } from "./naming-normalize.js";
import type { NamingDictionary, NamingEntry } from "./naming-types.js";

export type NamingIndex = {
  readonly schemaVersion: 1;
  readonly entries: readonly NamingEntry[];
  readonly byExactName: Record<string, readonly string[]>;
  readonly byNormalizedName: Record<string, readonly string[]>;
  readonly byNamespaceName: Record<string, readonly string[]>;
  readonly byKind: Record<string, readonly string[]>;
  readonly byToken: Record<string, readonly string[]>;
  readonly byCollisionGroup: Record<string, readonly string[]>;
  readonly bySourceRef: Record<string, readonly string[]>;
};

export function buildNamingIndex(dictionary: NamingDictionary): NamingIndex {
  const entries = [...dictionary.entries].sort(compareEntries);
  const byExactName = new Map<string, Set<string>>();
  const byNormalizedName = new Map<string, Set<string>>();
  const byNamespaceName = new Map<string, Set<string>>();
  const byKind = new Map<string, Set<string>>();
  const byToken = new Map<string, Set<string>>();
  const byCollisionGroup = new Map<string, Set<string>>();
  const bySourceRef = new Map<string, Set<string>>();

  for (const entry of entries) {
    addToGroup(byExactName, exactNamingLookupKey(entry.name), entry.id);
    addToGroup(byNormalizedName, normalizedNamingLookupKey(entry.name), entry.id);
    addToGroup(byNamespaceName, namespaceNameKey(entry), entry.id);
    addToGroup(byKind, entry.kind, entry.id);
    addToGroup(byCollisionGroup, entry.collisionGroup, entry.id);
    for (const token of entry.tokens) addToGroup(byToken, normalizedNamingToken(token), entry.id);
    for (const sourceRef of entry.sourceRefs) addToGroup(bySourceRef, sourceRef, entry.id);
  }

  return {
    schemaVersion: 1,
    entries,
    byExactName: sortedRecord(byExactName),
    byNormalizedName: sortedRecord(byNormalizedName),
    byNamespaceName: sortedRecord(byNamespaceName),
    byKind: sortedRecord(byKind),
    byToken: sortedRecord(byToken),
    byCollisionGroup: sortedRecord(byCollisionGroup),
    bySourceRef: sortedRecord(bySourceRef),
  };
}

function namespaceNameKey(entry: NamingEntry): string {
  return `${entry.namespace}:${entry.name}`;
}

function addToGroup(groups: Map<string, Set<string>>, key: string, entryId: string): void {
  const current = groups.get(key);
  if (current) {
    current.add(entryId);
    return;
  }
  groups.set(key, new Set([entryId]));
}

function sortedRecord(groups: Map<string, Set<string>>): Record<string, readonly string[]> {
  const record: Record<string, readonly string[]> = {};
  for (const key of [...groups.keys()].sort()) {
    const values = groups.get(key);
    record[key] = values ? [...values].sort() : [];
  }
  return record;
}

function compareEntries(left: NamingEntry, right: NamingEntry): number {
  return left.id.localeCompare(right.id);
}
