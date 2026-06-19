import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseNamingDictionary } from "../dist/naming/naming-dictionary.js";
import { checkNamingDictionary } from "../dist/naming/naming-check.js";
import { buildNamingIndex } from "../dist/naming/naming-index.js";
import { appendNamingEvent, readNamingEvents, readNamingIndex, writeNamingIndex } from "../dist/naming/naming-storage.js";
import { NamingDictionaryReadError } from "../dist/naming/naming-types.js";

test("naming dictionary accepts the canonical starter dictionary", async () => {
  // Given: the committed canonical dictionary source.
  const raw = await readFile("docs/naming/dictionary.json", "utf8");
  const parsed = JSON.parse(raw);

  // When: the JSON boundary parser reads it.
  const dictionary = parseNamingDictionary(parsed, "docs/naming/dictionary.json");

  // Then: the starter source reserves model settings and overloaded stems.
  assert.equal(dictionary.schemaVersion, 1);
  assert.deepEqual(dictionary.entries.map((entry) => entry.id), [...dictionary.entries.map((entry) => entry.id)].sort());
  assert.deepEqual(dictionary.entries.filter((entry) => entry.namespace === "model-settings").map((entry) => entry.name), ["anthropicBudgetTokens", "openaiEffort", "providerServiceTier", "providerToolChoice", "temperature", "topK", "topP"]);
  assert.deepEqual(dictionary.entries.filter((entry) => entry.collisionGroup === "overloaded-stems").map((entry) => entry.name), ["create", "index", "input", "result", "symbol", "workflow"]);
});

test("naming dictionary rejects malformed naming entries with structured diagnostics", () => {
  // Given: a malformed fixture missing required namespace/status/casing fields.
  const malformed = {
    schemaVersion: 1,
    entries: [
      {
        id: "setting.badTopK",
        name: "badTopK",
        normalized: "badtopk",
        kind: "setting",
        tokens: ["bad", "top", "K"],
        collisionGroup: "model-sampling",
        aliases: [],
        blockedVariants: [],
        sourceRefs: ["fixture"],
        meaning: "Broken fixture.",
      },
    ],
  };

  // When: the parser reads the malformed data.
  // Then: callers can inspect stable diagnostics instead of parsing messages.
  assert.throws(() => parseNamingDictionary(malformed, "fixture.json"), (error) => {
    assert.ok(error instanceof NamingDictionaryReadError);
    assert.deepEqual(error.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.path]), [["missing_required_field", "entries[0].casing"], ["missing_required_field", "entries[0].namespace"], ["missing_required_field", "entries[0].status"]]);
    return true;
  });
});

test("naming dictionary rejects extra entry properties", () => {
  // Given: an entry with a field outside the canonical schema.
  const malformed = {
    schemaVersion: 1,
    entries: [
      {
        id: "setting.temperature",
        name: "temperature",
        normalized: "temperature",
        kind: "setting",
        namespace: "model-settings",
        casing: "lowerCase",
        tokens: ["temperature"],
        status: "reserved",
        collisionGroup: "model-sampling",
        aliases: [],
        blockedVariants: ["temp"],
        sourceRefs: ["fixture"],
        meaning: "Sampling temperature.",
        arbitrary: true,
      },
    ],
  };

  // When: the parser reads the malformed data.
  // Then: the parser enforces the same closed entry shape as the JSON schema.
  assert.throws(() => parseNamingDictionary(malformed, "fixture.json"), (error) => {
    assert.ok(error instanceof NamingDictionaryReadError);
    assert.deepEqual(error.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.path]), [["unknown_field", "entries[0].arbitrary"]]);
    return true;
  });
});

test("naming dictionary schema keeps entries closed", async () => {
  // Given: the committed JSON schema.
  const schema = JSON.parse(await readFile("docs/naming/dictionary.schema.json", "utf8"));

  // When: the entry definition is inspected directly.
  const entrySchema = schema.definitions.namingEntry;

  // Then: future schema consumers see closed canonical entry objects.
  assert.equal(entrySchema.additionalProperties, false);
  assert.deepEqual(entrySchema.required, ["id", "name", "normalized", "kind", "namespace", "casing", "tokens", "status", "collisionGroup", "aliases", "blockedVariants", "sourceRefs", "meaning"]);
});

test("naming index builds deterministic exact normalized and grouping maps", () => {
  // Given: entries arrive out of order and share lookup groups.
  const dictionary = parseNamingDictionary(
    {
      schemaVersion: 1,
      entries: [
        namingEntry("tool.wikiContext", "wiki_context", "tool", "opencode", "snake_case", ["wiki", "context"], "tooling", ["src/opencode/tiny-plugin.ts:wiki_context"]),
        namingEntry("setting.topP", "topP", "setting", "model-settings", "camelCase", ["top", "P"], "model-sampling", ["src/opencode/agent-model-options.ts:topP"]),
        namingEntry("setting.topK", "topK", "setting", "model-settings", "camelCase", ["top", "K"], "model-sampling", ["src/opencode/agent-model-options.ts:topK"]),
      ],
    },
    "fixture.json",
  );

  // When: the dictionary is indexed for lookup.
  const index = buildNamingIndex(dictionary);

  // Then: every map and array is stable and sorted.
  assert.deepEqual(index.entries.map((entry) => entry.id), ["setting.topK", "setting.topP", "tool.wikiContext"]);
  assert.deepEqual(index.byExactName, { topK: ["setting.topK"], topP: ["setting.topP"], wiki_context: ["tool.wikiContext"] });
  assert.deepEqual(index.byNormalizedName, { topk: ["setting.topK"], topp: ["setting.topP"], wikicontext: ["tool.wikiContext"] });
  assert.deepEqual(index.byNamespaceName, { "model-settings:topK": ["setting.topK"], "model-settings:topP": ["setting.topP"], "opencode:wiki_context": ["tool.wikiContext"] });
  assert.deepEqual(index.byKind, { setting: ["setting.topK", "setting.topP"], tool: ["tool.wikiContext"] });
  assert.deepEqual(index.byToken, { context: ["tool.wikiContext"], k: ["setting.topK"], p: ["setting.topP"], top: ["setting.topK", "setting.topP"], wiki: ["tool.wikiContext"] });
  assert.deepEqual(index.byCollisionGroup, { "model-sampling": ["setting.topK", "setting.topP"], tooling: ["tool.wikiContext"] });
  assert.deepEqual(index.bySourceRef, { "src/opencode/agent-model-options.ts:topK": ["setting.topK"], "src/opencode/agent-model-options.ts:topP": ["setting.topP"], "src/opencode/tiny-plugin.ts:wiki_context": ["tool.wikiContext"] });
});

test("naming index storage writes reads and appends generated tiny naming state", async (t) => {
  // Given: a temporary Tiny-Chu root and a generated empty index.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-naming-index-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const index = buildNamingIndex({ schemaVersion: 1, entries: [] });
  const firstEvent = namingProposalEvent("event-1", "newName", "pending", "2026-06-17T00:00:00.000Z");
  const secondEvent = namingProposalEvent("event-2", "otherName", "duplicate", "2026-06-17T00:00:01.000Z");

  // When: index and proposal events are written through the storage helpers.
  await writeNamingIndex(root, index);
  await appendNamingEvent(root, firstEvent);
  await appendNamingEvent(root, secondEvent);

  // Then: callers can read stable generated state from .tiny/naming.
  assert.deepEqual(await readNamingIndex(root), index);
  assert.deepEqual(await readNamingEvents(root), [firstEvent, secondEvent]);
  assert.equal(JSON.parse(await readFile(path.join(root, ".tiny", "naming", "index.json"), "utf8")).schemaVersion, 1);
});

test("collision policy allows compatible duplicates and reports dictionary violations", () => {
  const dictionary = parseNamingDictionary(
    {
      schemaVersion: 1,
      entries: [
        namingEntry("function.createTask", "createTask", "function", "shared", "camelCase", ["create", "Task"], "task-api", ["src/a.ts:1"], { meaning: "Creates a task." }),
        namingEntry("function.createTask.alias", "create_task", "function", "shared", "snake_case", ["create", "Task"], "task-api", ["src/b.ts:1"], { meaning: "Creates a task." }),
        namingEntry("setting.topK", "topK", "setting", "model-settings", "camelCase", ["top", "K"], "model-sampling", ["src/model.ts:1"], { status: "reserved", blockedVariants: ["top_k"], meaning: "Top-K sampling." }),
        namingEntry("setting.topK.other", "top_k", "setting", "model-settings", "snake_case", ["top", "K"], "model-sampling", ["src/model.ts:2"], { meaning: "Other top K meaning." }),
      ],
    },
    "fixture.json",
  );
  const result = checkNamingDictionary({
    dictionary,
    candidate: { name: "top_k", kind: "setting", namespace: "model-settings", sourceRefs: ["candidate"], meaning: "Candidate." },
    symbols: [namingSymbol("src/shared.ts:1", "topK", "variable", "shared", true)],
  });
  assert.equal(result.status, "fail");
  assert.deepEqual(codes(result), ["blocked_variant", "duplicate_compatible_entry", "reserved_term_misuse", "semantic_name_conflict"]);
});

test("collision policy reports public and tool duplicates without local variable noise", () => {
  const dictionary = parseNamingDictionary({ schemaVersion: 1, entries: [] }, "fixture.json");
  const result = checkNamingDictionary({
    dictionary,
    symbols: [
      namingSymbol("src/index.ts:1", "loadContextBundle", "term", "shared", true, "export"),
      namingSymbol("src/index.ts:2", "loadContextBundle", "term", "shared", true, "export"),
      namingSymbol("src/tools-a.ts:1", "wiki_context", "tool", "opencode", false),
      namingSymbol("src/tools-b.ts:1", "wiki_context", "tool", "opencode", false),
      namingSymbol("src/a.ts:10", "status", "variable", "shared", false),
      namingSymbol("src/b.ts:10", "status", "variable", "shared", false),
    ],
  });
  assert.equal(result.status, "fail");
  assert.deepEqual(codes(result), ["duplicate_public_export", "duplicate_tool_name"]);
});

test("collision policy accepts canonical reserved spelling and blocks variants", async () => {
  const dictionary = parseNamingDictionary(await readFile("docs/naming/dictionary.json", "utf8"), "docs/naming/dictionary.json");
  const canonical = checkNamingDictionary({
    dictionary,
    candidate: { name: "topK", kind: "setting", namespace: "model-settings", sourceRefs: ["qa"], meaning: "Top-K sampling cutoff for providers that support it." },
  });
  const blocked = checkNamingDictionary({
    dictionary,
    candidate: { name: "top_k", kind: "setting", namespace: "model-settings", sourceRefs: ["qa"], meaning: "Top-K sampling cutoff for providers that support it." },
  });

  assert.equal(canonical.status, "pass");
  assert.equal(codes(canonical).includes("blocked_variant"), false);
  assert.equal(blocked.status, "fail");
  assert.ok(codes(blocked).includes("blocked_variant"));
});

test("collision policy rejects reserved model setting names outside model-settings", async () => {
  const dictionary = parseNamingDictionary(await readFile("docs/naming/dictionary.json", "utf8"), "docs/naming/dictionary.json");
  const result = checkNamingDictionary({
    dictionary,
    candidate: { name: "topK", kind: "variable", namespace: "shared", sourceRefs: ["qa"], meaning: "Misused model setting." },
  });

  assert.equal(result.status, "fail");
  assert.ok(codes(result).includes("reserved_term_misuse"));
});

test("naming context returns bounded model setting matches", async () => {
  // Given: the committed dictionary reserves canonical model settings.
  const { createNamingContext } = await import("../dist/naming/naming-context.js");

  // When: an agent asks for a bounded model-settings context around topk.
  const context = await createNamingContext({
    root: process.cwd(),
    query: "topk",
    namespace: "model-settings",
    maxEntries: 1,
  });

  // Then: the context returns the canonical spelling and truncation metadata.
  assert.equal(context.query, "topk");
  assert.equal(context.metadata.requestedEntries, 1);
  assert.equal(context.metadata.returnedEntries, 1);
  assert.equal(context.metadata.omittedEntries, 0);
  assert.equal(context.metadata.truncated, false);
  assert.deepEqual(context.matchedEntries.map((entry) => entry.name), ["topK"]);
  assert.deepEqual(context.matchedEntries[0].blockedVariants, ["top_k", "topk"]);
});

test("naming context warns and returns no matches for empty query", async () => {
  // Given: the naming context renderer is available.
  const { createNamingContext } = await import("../dist/naming/naming-context.js");

  // When: an agent sends an empty query.
  const context = await createNamingContext({
    root: process.cwd(),
    query: "",
    namespace: "model-settings",
    maxEntries: 5,
  });

  // Then: the renderer returns a bounded empty result instead of throwing.
  assert.deepEqual(context.matchedEntries, []);
  assert.equal(context.metadata.returnedEntries, 0);
  assert.equal(context.metadata.omittedEntries, 0);
  assert.equal(context.metadata.truncated, false);
  assert.ok(context.warnings.some((warning) => warning.code === "empty_query"));
});

function namingEntry(id, name, kind, namespace, casing, tokens, collisionGroup, sourceRefs, overrides = {}) {
  return {
    id,
    name,
    normalized: name.replaceAll(/[^A-Za-z0-9]/g, "").toLowerCase(),
    kind,
    namespace,
    casing,
    tokens,
    status: "active",
    collisionGroup,
    aliases: [],
    blockedVariants: [],
    sourceRefs,
    meaning: `${name} fixture.`,
    ...overrides,
  };
}

function namingSymbol(sourceRef, name, kind, namespace, exported, sourceKind) {
  return { symbolId: `${namespace}:${kind}:${name}:${sourceRef}`, name, kind, namespace, modulePath: sourceRef.split(":")[0], line: Number(sourceRef.split(":")[1] ?? 1), exported, sourceKind: sourceKind ?? (kind === "tool" ? "tool-seed" : "declaration"), sourceRefs: [sourceRef] };
}

function namingProposalEvent(id, name, status, createdAt) {
  return {
    id,
    createdAt,
    action: "propose",
    candidate: { name, kind: "term", namespace: "shared", sourceRefs: ["test"], meaning: `${name} proposal.` },
    normalized: name.replaceAll(/[^A-Za-z0-9]/g, "").toLowerCase(),
    status,
    diagnostics: [],
  };
}

function codes(result) {
  return result.diagnostics.map((diagnostic) => diagnostic.code).sort();
}
