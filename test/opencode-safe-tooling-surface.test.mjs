import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTinyChuPlugin, hashSourceTarget } from "../dist/index.js";
import { TinyChuOpenCodePlugin } from "../dist/opencode/plugin.js";

test("safe tooling runs through direct plugin and OpenCode opt-in surfaces", async () => {
  // Given: a source root with safe tooling disabled by default.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-safe-surface-"));
  await writeFile(path.join(root, "note.txt"), "old\n", "utf8");
  const defaultTiny = createTinyChuPlugin({ root });
  const tiny = createTinyChuPlugin({ root, safeTooling: true, nativePreviews: true });
  const before = await hashSourceTarget(root, "note.txt");
  const patch = [
    "diff --git a/note.txt b/note.txt",
    "--- a/note.txt",
    "+++ b/note.txt",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");

  // When: check/apply and OpenCode option exposure run.
  const checked = await tiny.tools.safe_patch_check({ patch, allowedTargets: ["note.txt"], expectedFiles: { "note.txt": before.hash } });
  const afterCheck = await readFile(path.join(root, "note.txt"), "utf8");
  const applied = await tiny.tools.safe_patch_apply({ patch, allowedTargets: ["note.txt"], expectedFiles: { "note.txt": before.hash } });
  const hooks = await TinyChuOpenCodePlugin({
    project: { root },
    directory: root,
    worktree: root,
    client: { app: { log: async () => undefined } },
    $: async () => undefined,
  }, { safeTooling: true, nativePreviews: true });

  // Then: default omits tools, opt-in exposes them, and apply changes only the expected file.
  assert.equal(defaultTiny.tools.safe_patch_check, undefined);
  assert.equal(checked.valid, true);
  assert.equal(afterCheck, "old\n");
  assert.equal(applied.applied, true);
  assert.equal(await readFile(path.join(root, "note.txt"), "utf8"), "new\n");
  assert.equal(typeof hooks.tool.safe_patch_check.execute, "function");
  assert.equal(typeof hooks.tool.artifact_publish_apply.execute, "function");
  assert.equal(typeof hooks.tool.structural_search_ast.execute, "function");
});

test("artifact workspace and publish handlers keep construction git outside source repo", async () => {
  // Given: a source root and opt-in safe tooling.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-artifact-surface-"));
  await mkdir(path.join(root, ".git"));
  await mkdir(path.join(root, "docs"));
  await writeFile(path.join(root, "docs", "report.md"), "# Old\n", "utf8");
  const tiny = createTinyChuPlugin({ root, safeTooling: true });

  // When: a workspace is prepared and a manifest is applied after a stale refusal.
  const workspace = await tiny.tools.artifact_workspace_prepare({
    allowedInputs: ["docs/report.md"],
    copyInputs: ["docs/report.md"],
    initGit: true,
  });
  await writeFile(path.join(workspace.workspaceRoot, "report.md"), "# New\n", "utf8");
  const manifest = await tiny.tools.artifact_publish_manifest({
    workspaceRoot: workspace.workspaceRoot,
    entries: [{ source: "report.md", target: "docs/report.md" }],
    allowedTargets: ["docs/**"],
  });
  await writeFile(path.join(root, "docs", "report.md"), "# Stale\n", "utf8");
  const stale = await tiny.tools.artifact_publish_apply({ manifestPath: manifest.manifestPath });
  await writeFile(path.join(root, "docs", "report.md"), "# Old\n", "utf8");
  const applied = await tiny.tools.artifact_publish_apply({ manifestPath: manifest.manifestPath });

  // Then: source git is distinct, stale target is refused, and valid publish writes the file.
  assert.equal(workspace.valid, true);
  assert.ok(await stat(path.join(workspace.workspaceRoot, ".git")));
  assert.notEqual(path.resolve(workspace.workspaceRoot, ".git"), path.resolve(root, ".git"));
  assert.equal(stale.applied, false);
  assert.equal(applied.applied, true);
  assert.equal(await readFile(path.join(root, "docs", "report.md"), "utf8"), "# New\n");
});
