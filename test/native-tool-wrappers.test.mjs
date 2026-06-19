import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJsonPatchPreview, createJsonYamlTransformPreview, createStructuralRewritePreview, createStructuralSearchAst } from "../dist/index.js";
import { createPortableSymlink as symlink } from "./support/symlink.mjs";

function runnerFor(map) {
  return async (command, args) => {
    const key = `${command} ${args.join(" ")}`;
    return map[key] ?? { status: "missing", command, args, exitCode: null, stdout: "", stderr: "", timedOut: false };
  };
}

test("structural_search_ast returns bounded matches without writing source", async () => {
  // Given: a fake ast-grep runner and a source file.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-native-search-"));
  await writeFile(path.join(root, "a.ts"), "const value = 1;\n", "utf8");
  const runner = runnerFor({
    "ast-grep --json --pattern const $A = $B --lang ts a.ts": {
      status: "ok",
      command: "ast-grep",
      args: [],
      exitCode: 0,
      stdout: JSON.stringify([{ file: "a.ts", range: { start: { line: 1, column: 1 } }, text: "const value = 1" }]),
      stderr: "",
      timedOut: false,
    },
  });

  // When: structural search runs.
  const result = await createStructuralSearchAst(root, { pattern: "const $A = $B", language: "ts", paths: ["a.ts"], runner });

  // Then: matches are returned and source bytes remain unchanged.
  assert.equal(result.status, "ready");
  assert.equal(result.matches.length, 1);
  assert.equal(await readFile(path.join(root, "a.ts"), "utf8"), "const value = 1;\n");
});

test("native preview wrappers degrade when optional binaries are missing", async () => {
  // Given: an empty runner map.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-native-missing-"));
  const runner = runnerFor({});

  // When: optional wrapper tools run.
  const search = await createStructuralSearchAst(root, { pattern: "x", language: "ts", paths: ["a.ts"], runner });
  const rewrite = await createStructuralRewritePreview(root, { pattern: "x", rewrite: "y", language: "ts", paths: ["a.ts"], runner });
  const transform = await createJsonYamlTransformPreview(root, { tool: "jq", expression: ".", input: "{}", runner });
  const patch = await createJsonPatchPreview(root, { before: "{}", after: "{\"a\":1}", runner });

  // Then: every tool reports unavailable/degraded instead of throwing.
  assert.equal(search.status, "unavailable");
  assert.equal(rewrite.status, "unavailable");
  assert.equal(transform.status, "unavailable");
  assert.equal(patch.status, "unavailable");
});

test("native preview wrappers reject paths outside the configured root", async () => {
  // Given: a runner that would succeed if invoked.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-native-paths-"));
  const runner = runnerFor({
    "ast-grep --json --pattern x --lang ts ../escape.ts": { status: "ok", command: "ast-grep", args: [], exitCode: 0, stdout: "[]", stderr: "", timedOut: false },
  });

  // When: escaping paths are supplied.
  const search = await createStructuralSearchAst(root, { pattern: "x", language: "ts", paths: ["../escape.ts"], runner });
  const rewrite = await createStructuralRewritePreview(root, { pattern: "x", rewrite: "y", language: "ts", paths: ["/tmp/escape.ts"], runner });

  // Then: the wrapper refuses before native execution.
  assert.equal(search.status, "failed");
  assert.equal(rewrite.status, "failed");
  assert.match(search.diagnostics.join("\n"), /path/i);
  assert.match(rewrite.diagnostics.join("\n"), /path/i);
});

test("native preview wrappers reject root-relative symlink escapes", async () => {
  // Given: a root-relative directory symlink points outside root.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-native-symlink-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-native-outside-"));
  await writeFile(path.join(outside, "escape.ts"), "const outside = true;\n", "utf8");
  await symlink(outside, path.join(root, "linked"));
  const runner = runnerFor({
    "ast-grep --json --pattern x --lang ts linked/escape.ts": { status: "ok", command: "ast-grep", args: [], exitCode: 0, stdout: "[]", stderr: "", timedOut: false },
  });

  // When: a linked path is supplied.
  const result = await createStructuralSearchAst(root, { pattern: "x", language: "ts", paths: ["linked/escape.ts"], runner });

  // Then: the wrapper refuses before native execution.
  assert.equal(result.status, "failed");
  assert.match(result.diagnostics.join("\n"), /path/i);
});

test("structural_rewrite_preview and data previews return apply-through metadata only", async () => {
  // Given: fake native tool output.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-native-preview-"));
  const runner = runnerFor({
    "ast-grep --pattern foo --rewrite bar --lang ts --update-all --dry-run a.ts": {
      status: "ok",
      command: "ast-grep",
      args: [],
      exitCode: 0,
      stdout: "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-foo\n+bar\n",
      stderr: "",
      timedOut: false,
    },
    "jq .": { status: "ok", command: "jq", args: [], exitCode: 0, stdout: "{\"a\":1}\n", stderr: "", timedOut: false },
    "jd -set": { status: "ok", command: "jd", args: [], exitCode: 0, stdout: "@ [\"a\"]\n+ 1\n", stderr: "", timedOut: false },
  });

  // When: preview tools run.
  const rewrite = await createStructuralRewritePreview(root, { pattern: "foo", rewrite: "bar", language: "ts", paths: ["a.ts"], runner });
  const transform = await createJsonYamlTransformPreview(root, { tool: "jq", expression: ".", input: "{\"a\":1}", runner });
  const patch = await createJsonPatchPreview(root, { before: "{}", after: "{\"a\":1}", runner });

  // Then: previews are bounded and never claim direct writes.
  assert.equal(rewrite.status, "ready");
  assert.equal(rewrite.requiresApplyTool, "safe_patch_apply");
  assert.match(rewrite.preview, /foo|bar/);
  assert.equal(transform.status, "ready");
  assert.equal(transform.wouldWrite, false);
  assert.equal(patch.status, "ready");
  assert.equal(patch.requiresApplyTool, "artifact_publish_apply");
});

test("json_yaml_transform_preview does not expose parent process environment through jq", async () => {
  // Given: the parent process contains a secret-looking environment value.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-native-env-"));
  process.env.TINY_CHU_SECRET_PROBE = "leak-value";

  try {
    // When: jq tries to read that value through its env builtin.
    const result = await createJsonYamlTransformPreview(root, {
      tool: "jq",
      expression: "env.TINY_CHU_SECRET_PROBE // \"\"",
      input: "{}",
    });

    // Then: the preview may run, but it must not return the inherited secret.
    assert.equal(result.status, "ready");
    assert.doesNotMatch(result.output, /leak-value/);
  } finally {
    delete process.env.TINY_CHU_SECRET_PROBE;
  }
});
