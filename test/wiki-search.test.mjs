import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WikiBundler } from "../dist/index.js";

async function makeRoot(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, ".tiny", "wiki", "domains"), { recursive: true });
  return root;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function writeWikiIndex(root, documents) {
  await writeFile(path.join(root, ".tiny", "wiki", "index.json"), `${JSON.stringify({ documents }, null, 2)}\n`, "utf8");
}

test("type contract exposes citation-bearing context shape", async () => {
  // Given
  const root = await makeRoot("tiny-chu-wiki-contract-");
  const body = "# Backend API\n\nUse durable API contracts for worker packets.\n";
  await writeFile(path.join(root, ".tiny", "wiki", "domains", "backend.md"), body, "utf8");
  await writeWikiIndex(root, [
    {
      id: "backend",
      path: ".tiny/wiki/domains/backend.md",
      canonical: true,
      tags: ["api", "worker"],
      freshness: "manual",
      title: "Backend API",
      summary: "Worker packet API contracts",
      sourceHash: sha256(body),
      aliases: ["server-api"],
      links: ["frontend"],
      backlinks: [],
      generatedFrom: { tool: "manual", evidenceRefs: ["adr-1"] },
    },
  ]);

  // When
  const result = await new WikiBundler(root).context({ mode: "query", query: "worker API", maxChunks: 1, maxChars: 1000 });

  // Then
  assert.equal(result.mode, "query");
  assert.equal(result.truncated, false);
  assert.equal(result.omitted, 0);
  assert.deepEqual(result.uncertainties, []);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].id, "backend#1");
  assert.equal(result.results[0].documentId, "backend");
  assert.equal(result.results[0].sourcePath, ".tiny/wiki/domains/backend.md");
  assert.equal(result.results[0].sourceHash, sha256(body));
  assert.equal(result.results[0].freshness, "manual");
  assert.equal(result.results[0].startLine, 1);
  assert.equal(result.results[0].endLine, 3);
  assert.deepEqual(result.results[0].headingPath, ["Backend API"]);
  assert.equal(typeof result.results[0].tokenEstimate, "number");
  assert.match(result.text, /backend#1/);
  assert.match(result.text, /\.tiny\/wiki\/domains\/backend\.md:1-3/);
});

test("chunk extraction is deterministic and clamps tiny max chunk sizes", async () => {
  // Given
  const { chunkMarkdownDocument } = await import("../dist/wiki/wiki-chunks.js");
  const text = [
    "# Architecture",
    "",
    "Short intro.",
    "",
    "## API",
    "",
    "alpha ".repeat(70).trim(),
    "",
    "beta ".repeat(70).trim(),
  ].join("\n");

  // When
  const result = chunkMarkdownDocument({
    document: { id: "architecture", path: ".tiny/wiki/domains/architecture.md", canonical: true, tags: ["api"], freshness: "manual" },
    sourcePath: ".tiny/wiki/domains/architecture.md",
    sourceHash: sha256(text),
    text,
    maxChunkChars: 40,
  });

  // Then
  assert.deepEqual(result.warnings.map((warning) => warning.code), ["max_chunk_chars_clamped"]);
  assert.equal(result.chunks[0].id, "architecture#1");
  assert.deepEqual(result.chunks[0].headingPath, ["Architecture"]);
  assert.equal(result.chunks[0].startLine, 1);
  assert.equal(result.chunks.at(-1).documentId, "architecture");
  assert.ok(result.chunks.length > 1);
  assert.ok(result.chunks.every((chunk) => chunk.text.length <= 200));
  assert.deepEqual(result.chunks.map((chunk) => chunk.ordinal), result.chunks.map((_, index) => index + 1));
});

test("search skips missing docs, warns on stale hashes, and fails closed for explicit missing refs", async () => {
  // Given
  const root = await makeRoot("tiny-chu-wiki-reader-");
  const current = "# API\n\nCurrent API guidance.\n";
  await writeFile(path.join(root, ".tiny", "wiki", "domains", "api.md"), current, "utf8");
  await writeWikiIndex(root, [
    { id: "api", path: ".tiny/wiki/domains/api.md", canonical: true, tags: ["api"], freshness: "on-merge", sourceHash: "stale" },
    { id: "missing", path: ".tiny/wiki/domains/missing.md", canonical: true, tags: ["api"], freshness: "manual" },
  ]);

  // When
  const search = await new WikiBundler(root).search({ query: "api" });

  // Then
  assert.equal(search.results.length, 1);
  assert.equal(search.results[0].documentId, "api");
  assert.ok(search.warnings.some((warning) => warning.code === "missing_document" && warning.documentId === "missing"));
  assert.ok(search.warnings.some((warning) => warning.code === "stale_source_hash" && warning.documentId === "api"));
  await assert.rejects(
    () => new WikiBundler(root).context({ mode: "refs", refs: ["missing"] }),
    (error) => error instanceof Error && error.name === "WikiDocumentReadError" && /missing/.test(error.message),
  );
});

test("search returns missing index warnings and throws structured malformed index errors", async () => {
  // Given
  const missingRoot = await makeRoot("tiny-chu-wiki-missing-index-");
  const malformedRoot = await makeRoot("tiny-chu-wiki-malformed-index-");
  await writeFile(path.join(malformedRoot, ".tiny", "wiki", "index.json"), "{ not json", "utf8");

  // When
  const missing = await new WikiBundler(missingRoot).search({ query: "api" });

  // Then
  assert.equal(missing.results.length, 0);
  assert.ok(missing.warnings.some((warning) => warning.code === "wiki_index_missing"));
  await assert.rejects(
    () => new WikiBundler(malformedRoot).search({ query: "api" }),
    (error) => error instanceof Error && error.name === "WikiIndexReadError" && /Malformed wiki index JSON/.test(error.message),
  );
});

test("search fails closed when a wiki path escapes root through a symlink", async () => {
  // Given
  const root = await makeRoot("tiny-chu-wiki-search-symlink-");
  const outside = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-wiki-search-outside-"));
  const outsideFile = path.join(outside, "outside.md");
  await writeFile(outsideFile, "# Escape\n\nOutside root.\n", "utf8");
  await symlink(outsideFile, path.join(root, ".tiny", "wiki", "domains", "linked.md"));
  await writeWikiIndex(root, [
    { id: "escape", path: ".tiny/wiki/domains/linked.md", canonical: true, tags: ["escape"], freshness: "manual" },
  ]);

  // When / Then
  await assert.rejects(
    () => new WikiBundler(root).search({ query: "outside" }),
    (error) => error instanceof Error && error.name === "WikiDocumentReadError" && /outside configured root|outside root/.test(error.message),
  );
});

test("search and context reject wiki index symlink escapes", async () => {
  // Given
  const directoryRoot = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-wiki-index-dir-search-"));
  const directoryOutside = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-wiki-index-dir-search-outside-"));
  await mkdir(path.join(directoryRoot, ".tiny"), { recursive: true });
  await writeFile(path.join(directoryOutside, "index.json"), `${JSON.stringify({
    documents: [{ id: "external", path: ".tiny/wiki/domains/external.md", canonical: true, tags: ["secret"], freshness: "manual" }],
  })}\n`, "utf8");
  await symlink(directoryOutside, path.join(directoryRoot, ".tiny", "wiki"));

  const fileRoot = await makeRoot("tiny-chu-wiki-index-file-search-");
  const fileOutside = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-wiki-index-file-search-outside-"));
  const outsideIndex = path.join(fileOutside, "index.json");
  await writeFile(outsideIndex, `${JSON.stringify({ documents: [] })}\n`, "utf8");
  await symlink(outsideIndex, path.join(fileRoot, ".tiny", "wiki", "index.json"));

  // When / Then
  await assert.rejects(() => new WikiBundler(directoryRoot).search({ query: "secret" }), /symlink|escapes root/);
  await assert.rejects(() => new WikiBundler(directoryRoot).context({ mode: "index" }), /symlink|escapes root/);
  await assert.rejects(() => new WikiBundler(fileRoot).search({ query: "secret" }), /symlink/);
  await assert.rejects(() => new WikiBundler(fileRoot).context({ mode: "index" }), /symlink/);
});

test("search ranking is deterministic for query id and tag selection", async () => {
  // Given
  const root = await makeRoot("tiny-chu-wiki-ranking-");
  await writeFile(path.join(root, ".tiny", "wiki", "domains", "api.md"), "# API\n\nWorker API worker API durable contracts.\n", "utf8");
  await writeFile(path.join(root, ".tiny", "wiki", "domains", "worker.md"), "# Worker Runtime\n\nAPI queue runtime notes.\n", "utf8");
  await writeWikiIndex(root, [
    { id: "worker", path: ".tiny/wiki/domains/worker.md", canonical: true, tags: ["runtime"], freshness: "manual", title: "Worker Runtime" },
    { id: "api", path: ".tiny/wiki/domains/api.md", canonical: true, tags: ["api"], freshness: "manual", title: "API" },
  ]);

  // When
  const query = await new WikiBundler(root).search({ query: "worker API", maxChunks: 10 });
  const tag = await new WikiBundler(root).search({ tags: ["runtime"], maxChunks: 10 });
  const id = await new WikiBundler(root).search({ ids: ["api"], maxChunks: 10 });

  // Then
  assert.deepEqual(query.results.map((result) => result.documentId), ["api", "worker"]);
  assert.ok(query.results[0].score > query.results[1].score);
  assert.deepEqual(tag.results.map((result) => result.documentId), ["worker"]);
  assert.deepEqual(id.results.map((result) => result.documentId), ["api"]);
});

test("search and context default to canonical documents while explicit refs can target drafts", async () => {
  // Given
  const root = await makeRoot("tiny-chu-wiki-canonical-default-");
  await writeFile(path.join(root, ".tiny", "wiki", "domains", "policy.md"), "# Policy\n\nStable canonical policy.\n", "utf8");
  await writeFile(path.join(root, ".tiny", "wiki", "domains", "draft.md"), "# Draft Policy\n\nDraft policy notes.\n", "utf8");
  await writeWikiIndex(root, [
    { id: "draft", path: ".tiny/wiki/domains/draft.md", canonical: false, tags: ["policy"], freshness: "generated", title: "Draft Policy" },
    { id: "policy", path: ".tiny/wiki/domains/policy.md", canonical: true, tags: ["policy"], freshness: "manual", title: "Policy" },
  ]);

  // When
  const search = await new WikiBundler(root).search({ query: "policy", maxChunks: 10 });
  const tagSearch = await new WikiBundler(root).search({ tags: ["policy"], maxChunks: 10 });
  const index = await new WikiBundler(root).context({ mode: "index", maxChunks: 10, maxChars: 1000 });
  const query = await new WikiBundler(root).context({ mode: "query", query: "policy", maxChunks: 10, maxChars: 1000 });
  const tagContext = await new WikiBundler(root).context({ mode: "query", tags: ["policy"], maxChunks: 10, maxChars: 1000 });
  const refs = await new WikiBundler(root).context({ mode: "refs", refs: ["draft"], maxChunks: 10, maxChars: 1000 });
  const inclusive = await new WikiBundler(root).search({ query: "policy", maxChunks: 10, includeNonCanonical: true });
  const inclusiveTags = await new WikiBundler(root).search({ tags: ["policy"], maxChunks: 10, includeNonCanonical: true });

  // Then
  assert.deepEqual(search.results.map((result) => result.documentId), ["policy"]);
  assert.deepEqual(tagSearch.results.map((result) => result.documentId), ["policy"]);
  assert.match(index.text, /id=policy/);
  assert.doesNotMatch(index.text, /id=draft/);
  assert.deepEqual(query.results.map((result) => result.documentId), ["policy"]);
  assert.deepEqual(tagContext.results.map((result) => result.documentId), ["policy"]);
  assert.deepEqual(refs.results.map((result) => result.documentId), ["draft"]);
  assert.deepEqual(inclusive.results.map((result) => result.documentId).sort(), ["draft", "policy"]);
  assert.deepEqual(inclusiveTags.results.map((result) => result.documentId).sort(), ["draft", "policy"]);
});

test("context renders compact citations and reports truncation metadata", async () => {
  // Given
  const root = await makeRoot("tiny-chu-wiki-context-");
  await writeFile(
    path.join(root, ".tiny", "wiki", "domains", "ops.md"),
    ["# Ops", "", "First paragraph about deployment evidence.", "", "## Rollback", "", "Rollback evidence must cite source lines."].join("\n"),
    "utf8",
  );
  await writeWikiIndex(root, [
    { id: "ops", path: ".tiny/wiki/domains/ops.md", canonical: true, tags: ["ops"], freshness: "generated", title: "Ops" },
  ]);

  // When
  const index = await new WikiBundler(root).context({ mode: "index", maxChars: 120 });
  const refs = await new WikiBundler(root).context({ mode: "refs", refs: ["ops"], maxChunks: 1, maxChars: 180 });
  const truncated = await new WikiBundler(root).context({ mode: "query", query: "evidence rollback", maxChunks: 5, maxChars: 120 });

  // Then
  assert.match(index.text, /wiki-index/);
  assert.match(index.text, /id=ops/);
  assert.equal(refs.results.length, 1);
  assert.match(refs.text, /ops#1/);
  assert.match(refs.text, /\.tiny\/wiki\/domains\/ops\.md:/);
  assert.equal(truncated.truncated, true);
  assert.ok(truncated.omitted >= 0);
  assert.ok(truncated.text.length <= 120);
  assert.ok(truncated.warnings.some((warning) => warning.code === "truncated"));
});
