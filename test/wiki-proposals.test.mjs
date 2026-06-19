import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { proposeWikiDocumentsFromRepoMap, resolveTinyChuPaths } from "../dist/index.js";
import { createPortableSymlink as symlink } from "./support/symlink.mjs";

async function makeWikiRoot(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, ".tiny", "wiki", "domains"), { recursive: true });
  return root;
}

test("repo map proposal flow creates proposals from layer evidence without writing wiki files", async () => {
  // Given
  const root = await makeWikiRoot("tiny-chu-wiki-proposals-");
  const indexFile = resolveTinyChuPaths(root).wikiIndexFile;
  const docFile = path.join(root, ".tiny", "wiki", "domains", "overview.md");
  const indexText = `${JSON.stringify({
    documents: [
      {
        id: "overview",
        path: ".tiny/wiki/domains/overview.md",
        canonical: true,
        tags: ["manual"],
        freshness: "manual",
      },
    ],
  }, null, 2)}\n`;
  const docText = "# Overview\n\nManual page.\n";
  await writeFile(indexFile, indexText, "utf8");
  await writeFile(docFile, docText, "utf8");

  // When
  const result = await proposeWikiDocumentsFromRepoMap(root, {
    layers: [
      {
        name: "api",
        files: ["src/opencode/tiny-plugin.ts"],
        evidence: ["src/opencode/tiny-plugin.ts: direct plugin handlers"],
      },
      {
        name: "domain",
        files: ["src/wiki/wiki-bundler.ts"],
        evidence: ["src/wiki/wiki-bundler.ts: wiki index reader"],
      },
    ],
    files: [
      {
        path: "src/wiki/wiki-bundler.ts",
        layer: "domain",
        reason: "Tiny-Chu wiki module",
      },
    ],
  });

  // Then
  assert.deepEqual(result.proposals.map((proposal) => proposal.documentId), ["repo-layer-api", "repo-layer-domain"]);
  assert.deepEqual(result.proposals.map((proposal) => proposal.kind), ["new_document", "new_document"]);
  assert.deepEqual(result.proposals[1].evidenceRefs, [
    "src/wiki/wiki-bundler.ts",
    "src/wiki/wiki-bundler.ts: Tiny-Chu wiki module",
    "src/wiki/wiki-bundler.ts: wiki index reader",
  ]);
  assert.equal(result.proposals[1].proposedRef.generatedFrom.tool, "repo_map");
  assert.equal(result.proposals[1].proposedRef.freshness, "generated");
  assert.equal(result.proposals[1].proposedRef.aliases.includes("domain layer"), true);
  assert.equal(await readFile(indexFile, "utf8"), indexText);
  assert.equal(await readFile(docFile, "utf8"), docText);
});

test("repo map proposal flow is backward compatible with old and v2 index metadata", async () => {
  // Given
  const oldRoot = await makeWikiRoot("tiny-chu-wiki-proposals-old-");
  await writeFile(resolveTinyChuPaths(oldRoot).wikiIndexFile, `${JSON.stringify({
    documents: [
      {
        id: "repo-layer-api",
        path: ".tiny/wiki/domains/api.md",
        canonical: false,
        tags: ["api"],
        freshness: "manual",
      },
    ],
  }, null, 2)}\n`, "utf8");

  const v2Root = await makeWikiRoot("tiny-chu-wiki-proposals-v2-");
  const v2IndexText = `${JSON.stringify({
    documents: [
      {
        id: "repo-layer-api",
        path: ".tiny/wiki/domains/api.md",
        canonical: false,
        tags: ["api"],
        freshness: "manual",
        aliases: ["HTTP API"],
        links: ["overview"],
        backlinks: ["routing"],
        sourceHash: "abc123",
        generatedFrom: {
          tool: "manual",
          evidenceRefs: ["docs/api.md:1"],
        },
      },
    ],
  }, null, 2)}\n`;
  await writeFile(resolveTinyChuPaths(v2Root).wikiIndexFile, v2IndexText, "utf8");
  const repoMap = {
    layers: [
      {
        name: "api",
        files: ["src/opencode/tiny-plugin.ts"],
        evidence: ["src/opencode/tiny-plugin.ts: direct plugin handlers"],
      },
    ],
  };

  // When
  const oldResult = await proposeWikiDocumentsFromRepoMap(oldRoot, repoMap);
  const v2Result = await proposeWikiDocumentsFromRepoMap(v2Root, repoMap);

  // Then
  assert.equal(oldResult.proposals[0].kind, "metadata_update");
  assert.equal(v2Result.proposals[0].kind, "metadata_update");
  assert.equal(v2Result.proposals[0].currentRef?.sourceHash, "abc123");
  assert.equal(v2Result.proposals[0].currentRef?.generatedFrom?.tool, "manual");
  assert.equal(await readFile(resolveTinyChuPaths(v2Root).wikiIndexFile, "utf8"), v2IndexText);
});

test("repo map proposal flow returns an empty proposal list for empty repo maps", async () => {
  // Given
  const root = await makeWikiRoot("tiny-chu-wiki-proposals-empty-");

  // When
  const result = await proposeWikiDocumentsFromRepoMap(root, { files: [], layers: [] });

  // Then
  assert.deepEqual(result.proposals, []);
  assert.deepEqual(result.warnings, ["repo_map_empty"]);
});

test("repo map proposal flow rejects symlinked wiki index directories", async () => {
  // Given
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-wiki-proposals-dir-symlink-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-wiki-proposals-dir-outside-"));
  await mkdir(path.join(root, ".tiny"), { recursive: true });
  await writeFile(path.join(outside, "index.json"), `${JSON.stringify({ documents: [] })}\n`, "utf8");
  await symlink(outside, path.join(root, ".tiny", "wiki"));

  // When / Then
  await assert.rejects(
    () => proposeWikiDocumentsFromRepoMap(root, { layers: [{ name: "api" }] }),
    /symlink|escapes root/,
  );
});

test("repo map proposal flow rejects symlinked wiki index files", async () => {
  // Given
  const root = await makeWikiRoot("tiny-chu-wiki-proposals-file-symlink-");
  const outside = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-wiki-proposals-file-outside-"));
  const outsideIndex = path.join(outside, "index.json");
  await writeFile(outsideIndex, `${JSON.stringify({ documents: [] })}\n`, "utf8");
  await symlink(outsideIndex, resolveTinyChuPaths(root).wikiIndexFile);

  // When / Then
  await assert.rejects(
    () => proposeWikiDocumentsFromRepoMap(root, { layers: [{ name: "api" }] }),
    /symlink/,
  );
  assert.equal(await readFile(outsideIndex, "utf8"), `${JSON.stringify({ documents: [] })}\n`);
});
