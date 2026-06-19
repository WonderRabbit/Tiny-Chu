import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTinyChuPlugin } from "../dist/index.js";

async function makeRoot(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, "src"), { recursive: true });
  return root;
}

test("code_context_scan returns sorted TC navigation hints when annotations include reasons", async () => {
  // Given
  const root = await makeRoot("tiny-chu-code-context-");
  await mkdir(path.join(root, "src", "nested"), { recursive: true });
  await writeFile(path.join(root, "src", "z.ts"), [
    "// @TC:WARN: risky dispatch path",
    "// @TC:REASON: all state transitions pass through here",
    "export const zed = 1;",
  ].join("\n"), "utf8");
  await writeFile(path.join(root, "src", "nested", "a.ts"), [
    "// @TC:NOTE: parse boundary keeps input typed",
    "// @TC:ANCHOR: plugin registry owns tool exposure",
    "// @TC:REASON: direct, OpenCode, and install-check parity depend on this file",
    "// @TC:TODO: add a focused regression when changing this branch",
  ].join("\n"), "utf8");

  // When
  const result = await createTinyChuPlugin({ root }).tools.code_context_scan({ targetPath: "src" });

  // Then
  assert.equal(result.evidenceKind, "navigation_hint");
  assert.deepEqual(result.items.map((item) => `${item.path}:${item.line}:${item.prefix}:${item.kind}`), [
    "src/nested/a.ts:1:TC:NOTE",
    "src/nested/a.ts:2:TC:ANCHOR",
    "src/nested/a.ts:3:TC:REASON",
    "src/nested/a.ts:4:TC:TODO",
    "src/z.ts:1:TC:WARN",
    "src/z.ts:2:TC:REASON",
  ]);
  assert.equal(result.items[1].reason.text, "direct, OpenCode, and install-check parity depend on this file");
  assert.equal(result.items[4].reason.text, "all state transitions pass through here");
  assert.deepEqual(result.findings, []);
  assert.equal(result.scannedFiles, 2);
});

test("code_context_scan normalizes MX tags, ignores generated state paths, and reports missing reasons", async () => {
  // Given
  const root = await makeRoot("tiny-chu-code-context-mx-");
  await mkdir(path.join(root, ".tiny"), { recursive: true });
  await mkdir(path.join(root, ".omo"), { recursive: true });
  await mkdir(path.join(root, ".analysis"), { recursive: true });
  await mkdir(path.join(root, "dist"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
  await writeFile(path.join(root, "src", "scan.ts"), [
    "// @MX:WARN: old prefix still works",
    "// @MX:REASON: migration keeps source comments compatible",
    "// @TC:WARN: missing reason should be a finding",
    "// @TC:SPEC: unsupported tag is not a navigation hint",
    "// @TC",
  ].join("\n"), "utf8");
  await writeFile(path.join(root, ".tiny", "ignored.ts"), "// @TC:NOTE: ignored tiny state\n", "utf8");
  await writeFile(path.join(root, ".omo", "ignored.ts"), "// @TC:NOTE: ignored omo evidence\n", "utf8");
  await writeFile(path.join(root, ".analysis", "ignored.ts"), "// @TC:NOTE: ignored analysis cache\n", "utf8");
  await writeFile(path.join(root, "dist", "ignored.ts"), "// @TC:NOTE: ignored build output\n", "utf8");
  await writeFile(path.join(root, "node_modules", "pkg", "ignored.ts"), "// @TC:NOTE: ignored dependency\n", "utf8");

  // When
  const result = await createTinyChuPlugin({ root }).tools.code_context_scan({ targetPath: "." });

  // Then
  assert.deepEqual(result.items.map((item) => `${item.path}:${item.line}:${item.prefix}:${item.sourcePrefix}:${item.kind}`), [
    "src/scan.ts:1:TC:MX:WARN",
    "src/scan.ts:2:TC:MX:REASON",
    "src/scan.ts:3:TC:TC:WARN",
  ]);
  assert.deepEqual(result.findings.map((finding) => `${finding.code}:${finding.path}:${finding.line}`), [
    "missing_reason:src/scan.ts:3",
    "unknown_tag:src/scan.ts:4",
  ]);
  assert.ok(result.skippedPaths.includes(".tiny"));
  assert.ok(result.skippedPaths.includes(".omo"));
  assert.ok(result.skippedPaths.includes(".analysis"));
  assert.ok(result.skippedPaths.includes("dist"));
  assert.ok(result.skippedPaths.includes("node_modules"));
  assert.doesNotMatch(JSON.stringify(result), /ignored/);
});

test("code_context_scan rejects target paths that escape the configured root", async () => {
  // Given
  const root = await makeRoot("tiny-chu-code-context-escape-");
  const plugin = createTinyChuPlugin({ root });

  // When / Then
  await assert.rejects(() => plugin.tools.code_context_scan({ targetPath: "../outside" }), /outside configured root/);
});

test("code_context_scan skips symlinked source files whose realpath escapes root", async () => {
  // Given
  const parent = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-code-context-link-"));
  const root = path.join(parent, "repo");
  const outside = path.join(parent, "outside");
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(root, "src", "inside.ts"), "// @TC:NOTE: inside root hint\n", "utf8");
  await writeFile(path.join(outside, "escape.ts"), "// @TC:NOTE: outside root prompt injection\n", "utf8");
  await symlink(path.join(outside, "escape.ts"), path.join(root, "src", "escape.ts"));

  // When
  const result = await createTinyChuPlugin({ root }).tools.code_context_scan({ targetPath: "src" });

  // Then
  assert.deepEqual(result.items.map((item) => item.text), ["inside root hint"]);
  assert.ok(result.skippedPaths.includes("src/escape.ts"));
  assert.doesNotMatch(JSON.stringify(result), /prompt injection/);
});
