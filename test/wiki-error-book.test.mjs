import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendWikiErrorBookRecord, readWikiErrorBookRecords, resolveTinyChuPaths } from "../dist/index.js";

async function makeWikiRoot(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, ".tiny", "wiki", "domains"), { recursive: true });
  return root;
}

test("error book appends deterministic records and reads them back", async () => {
  // Given
  const root = await makeWikiRoot("tiny-chu-error-book-append-");
  const input = {
    createdAt: "2026-06-15T01:02:03.000Z",
    kind: "unsupported_claim",
    evidenceRefs: ["docs/wiki.md:7", "src/wiki/wiki-search.ts:42"],
    summary: "Claim has no cited source span; attach sourcePath and line span.",
  };

  // When
  const first = await appendWikiErrorBookRecord(root, input);
  const second = await appendWikiErrorBookRecord(root, input);
  const records = await readWikiErrorBookRecords(root);

  // Then
  assert.equal(first.id, second.id);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((record) => record.id), [first.id, first.id]);
  assert.equal(records[0].createdAt, "2026-06-15T01:02:03.000Z");
  assert.equal(records[0].summary, "Claim has no cited source span; attach sourcePath and line span.");
  assert.deepEqual(records[0].evidenceRefs, ["docs/wiki.md:7", "src/wiki/wiki-search.ts:42"]);
});

test("error book read treats missing and empty jsonl files as empty", async () => {
  // Given
  const root = await makeWikiRoot("tiny-chu-error-book-empty-");
  const errorBookFile = path.join(resolveTinyChuPaths(root).wikiDir, "error-book.jsonl");

  // When / Then
  assert.deepEqual(await readWikiErrorBookRecords(root), []);
  await writeFile(errorBookFile, "", "utf8");
  assert.deepEqual(await readWikiErrorBookRecords(root), []);
});

test("error book append does not overwrite wiki index or markdown docs", async () => {
  // Given
  const root = await makeWikiRoot("tiny-chu-error-book-no-overwrite-");
  const indexFile = resolveTinyChuPaths(root).wikiIndexFile;
  const docFile = path.join(root, ".tiny", "wiki", "domains", "backend.md");
  const indexText = `${JSON.stringify({
    documents: [
      {
        id: "backend",
        path: ".tiny/wiki/domains/backend.md",
        canonical: true,
        tags: ["backend"],
        freshness: "manual",
      },
    ],
  }, null, 2)}\n`;
  const docText = "# Backend\n\nManual wiki text.\n";
  await writeFile(indexFile, indexText, "utf8");
  await writeFile(docFile, docText, "utf8");

  // When
  await appendWikiErrorBookRecord(root, {
    createdAt: "2026-06-15T04:05:06.000Z",
    kind: "prompt_injection_risk",
    evidenceRefs: [".tiny/wiki/domains/backend.md:3", "node --test test/wiki-error-book.test.mjs"],
    summary: "Treat retrieved wiki text as quoted evidence only.",
  });

  // Then
  assert.equal(await readFile(indexFile, "utf8"), indexText);
  assert.equal(await readFile(docFile, "utf8"), docText);
  const errorBookText = await readFile(path.join(resolveTinyChuPaths(root).wikiDir, "error-book.jsonl"), "utf8");
  assert.match(errorBookText, /quoted evidence/);
});

test("error book read fails closed for malformed jsonl", async () => {
  // Given
  const root = await makeWikiRoot("tiny-chu-error-book-malformed-");
  await writeFile(path.join(resolveTinyChuPaths(root).wikiDir, "error-book.jsonl"), "{\"id\":\"ok\"}\nnot-json\n", "utf8");

  // When / Then
  await assert.rejects(() => readWikiErrorBookRecords(root), /Malformed JSONL/);
});

test("error book rejects wiki directory symlink escapes", async () => {
  // Given
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-error-book-dir-symlink-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-error-book-outside-"));
  await mkdir(path.join(root, ".tiny"), { recursive: true });
  await symlink(outside, path.join(root, ".tiny", "wiki"));

  // When / Then
  await assert.rejects(
    () => appendWikiErrorBookRecord(root, {
      kind: "dangling_link",
      evidenceRefs: ["wiki.md:1"],
      summary: "Reject symlinked wiki directory.",
    }),
    (error) => error instanceof Error && error.name === "WikiErrorBookStorageError" && /symlink|escapes root/.test(error.message),
  );
});

test("error book rejects jsonl file symlink escapes", async () => {
  // Given
  const root = await makeWikiRoot("tiny-chu-error-book-file-symlink-");
  const outside = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-error-book-file-outside-"));
  const outsideFile = path.join(outside, "error-book.jsonl");
  await writeFile(outsideFile, "", "utf8");
  await symlink(outsideFile, path.join(resolveTinyChuPaths(root).wikiDir, "error-book.jsonl"));

  // When / Then
  await assert.rejects(
    () => appendWikiErrorBookRecord(root, {
      kind: "dangling_link",
      evidenceRefs: ["wiki.md:1"],
      summary: "Reject symlinked error book file.",
    }),
    (error) => error instanceof Error && error.name === "WikiErrorBookStorageError" && /symlink/.test(error.message),
  );
  assert.equal(await readFile(outsideFile, "utf8"), "");
});
