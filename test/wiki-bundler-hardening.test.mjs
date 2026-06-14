import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WikiBundler } from "../dist/index.js";

async function makeRoot(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, ".tiny", "wiki", "domains"), { recursive: true });
  return root;
}

test("WikiBundler selects canonical docs and tag matches when paths stay inside root", async () => {
  // Given
  const root = await makeRoot("tiny-chu-wiki-happy-");
  await writeFile(path.join(root, ".tiny", "wiki", "domains", "backend.md"), "Backend truth", "utf8");
  await writeFile(path.join(root, ".tiny", "wiki", "domains", "frontend.md"), "Frontend truth", "utf8");
  const wiki = new WikiBundler(root);
  await wiki.upsertDocument({ id: "backend", path: ".tiny/wiki/domains/backend.md", canonical: true, tags: ["backend", "api"], freshness: "manual" });
  await wiki.upsertDocument({ id: "frontend", path: ".tiny/wiki/domains/frontend.md", canonical: false, tags: ["frontend"], freshness: "manual" });

  // When
  const canonical = await wiki.bundle();
  const tagged = await wiki.bundle(["frontend"]);

  // Then
  assert.match(canonical.text, /Backend truth/);
  assert.doesNotMatch(canonical.text, /Frontend truth/);
  assert.match(tagged.text, /Frontend truth/);
});

test("WikiBundler allows inside-root symlinks whose real path stays inside root", async () => {
  // Given
  const root = await makeRoot("tiny-chu-wiki-symlink-inside-");
  const target = path.join(root, ".tiny", "wiki", "domains", "backend.md");
  await writeFile(target, "Backend truth through link", "utf8");
  await symlink(target, path.join(root, ".tiny", "wiki", "domains", "linked.md"));
  const wiki = new WikiBundler(root);
  await wiki.upsertDocument({ id: "linked", path: ".tiny/wiki/domains/linked.md", canonical: true, tags: ["backend"], freshness: "manual" });

  // When
  const bundle = await wiki.bundle(["backend"]);

  // Then
  assert.match(bundle.text, /Backend truth through link/);
});

test("WikiBundler rejects relative parent refs that escape the configured root", async () => {
  // Given
  const parent = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-wiki-relative-parent-"));
  const root = path.join(parent, "repo");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(parent, "outside.md"), "Outside truth", "utf8");
  const wiki = new WikiBundler(root);
  await wiki.upsertDocument({ id: "outside", path: "../outside.md", canonical: true, tags: ["escape"], freshness: "manual" });

  // When / Then
  await assert.rejects(() => wiki.bundle(), /outside configured root|outside root/);
});

test("WikiBundler rejects absolute document refs outside the configured root", async () => {
  // Given
  const root = await makeRoot("tiny-chu-wiki-absolute-root-");
  const outside = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-wiki-absolute-outside-"));
  const outsideFile = path.join(outside, "outside.md");
  await writeFile(outsideFile, "Outside truth", "utf8");
  const wiki = new WikiBundler(root);
  await wiki.upsertDocument({ id: "outside", path: outsideFile, canonical: true, tags: ["escape"], freshness: "manual" });

  // When / Then
  await assert.rejects(() => wiki.bundle(), /outside configured root|outside root/);
});

test("WikiBundler rejects inside-root symlinks whose real path escapes the configured root", async () => {
  // Given
  const root = await makeRoot("tiny-chu-wiki-symlink-root-");
  const outside = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-wiki-symlink-outside-"));
  const outsideFile = path.join(outside, "outside.md");
  await writeFile(outsideFile, "Outside truth", "utf8");
  await symlink(outsideFile, path.join(root, ".tiny", "wiki", "domains", "linked.md"));
  const wiki = new WikiBundler(root);
  await wiki.upsertDocument({ id: "linked", path: ".tiny/wiki/domains/linked.md", canonical: true, tags: ["escape"], freshness: "manual" });

  // When / Then
  await assert.rejects(() => wiki.bundle(), /outside configured root|outside root/);
});
