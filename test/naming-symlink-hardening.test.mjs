import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { extractNamingSymbols } from "../dist/naming/naming-extract.js";
import { appendNamingEvent } from "../dist/naming/naming-storage.js";

test("naming storage rejects symlinked naming directory before outside writes", async (t) => {
  // Given: .tiny/naming is a symlink to a directory outside the configured root.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-naming-dir-symlink-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-naming-dir-outside-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await mkdir(path.join(root, ".tiny"), { recursive: true });
  await symlink(outside, path.join(root, ".tiny", "naming"));

  // When: a naming proposal event append targets generated state.
  const error = await rejected(() => appendNamingEvent(root, namingProposalEvent("dir-escape")));

  // Then: storage fails closed before creating outside generated state.
  assert.match(error.message, /symlink|escapes root|outside root|outside configured root/i);
  await assert.rejects(() => access(path.join(outside, "events.jsonl")));
});

test("naming storage rejects symlinked events file before outside appends", async (t) => {
  // Given: .tiny/naming/events.jsonl points to a file outside the configured root.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-naming-file-symlink-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-naming-file-outside-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const outsideEvents = path.join(outside, "events.jsonl");
  await mkdir(path.join(root, ".tiny", "naming"), { recursive: true });
  await writeFile(outsideEvents, "", "utf8");
  await symlink(outsideEvents, path.join(root, ".tiny", "naming", "events.jsonl"));

  // When: a naming proposal event append targets the symlinked file.
  const error = await rejected(() => appendNamingEvent(root, namingProposalEvent("file-escape")));

  // Then: storage fails closed before appending to the outside file.
  assert.match(error.message, /symlink|escapes root|outside root|outside configured root/i);
  assert.equal(await readFile(outsideEvents, "utf8"), "");
});

test("naming extractor rejects symlinked source root that escapes root", async (t) => {
  // Given: root/src is a symlink to source files outside the configured root.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-naming-src-symlink-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-naming-src-outside-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module" }), "utf8");
  await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022" }, include: ["src/**/*.ts"] }), "utf8");
  await writeFile(path.join(outside, "leak.ts"), "export function leakedSecretName() { return 1 }\n", "utf8");
  await symlink(outside, path.join(root, "src"));

  // When: extraction scans the configured root.
  const error = await rejected(() => extractNamingSymbols(root));

  // Then: extraction rejects the escaped source tree instead of reading outside symbols.
  assert.match(error.message, /symlink|escapes root|outside root|outside configured root/i);
});

async function rejected(action) {
  try {
    await action();
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`Expected Error rejection, received ${String(error)}`);
  }
  throw new Error("Expected operation to reject");
}

function namingProposalEvent(id) {
  return {
    id,
    createdAt: "2026-06-17T00:00:00.000Z",
    action: "propose",
    candidate: { name: "escapedName", kind: "term", namespace: "shared", sourceRefs: ["test"], meaning: "Escaped naming proposal." },
    normalized: "escapedname",
    status: "pending",
    diagnostics: [],
  };
}
