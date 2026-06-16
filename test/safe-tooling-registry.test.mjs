import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTinyChuPlugin } from "../dist/index.js";
import { TinyChuOpenCodePlugin } from "../dist/opencode/plugin.js";

const SAFE_TOOLING_TOOL_NAMES = [
  "artifact_publish_apply",
  "artifact_publish_manifest",
  "artifact_workspace_commit",
  "artifact_workspace_prepare",
  "powershell_toolchain_probe",
  "run_diagnostics",
  "safe_patch_apply",
  "safe_patch_check",
];
const NATIVE_PREVIEW_TOOL_NAMES = [
  "json_patch_preview",
  "json_yaml_transform_preview",
  "structural_rewrite_preview",
  "structural_search_ast",
];

test("safe tooling and native previews are opt-in registry packages", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-safe-tooling-registry-"));
  const baseline = createTinyChuPlugin({ root });
  const nativeOnly = createTinyChuPlugin({ root, nativePreviews: true });
  const safe = createTinyChuPlugin({ root, safeTooling: true });
  const safeNative = createTinyChuPlugin({ root, safeTooling: true, nativePreviews: true });
  const hooks = await TinyChuOpenCodePlugin({
    project: { root },
    directory: root,
    worktree: root,
    client: { app: { log: async () => undefined } },
    $: async () => undefined,
  }, { safeTooling: true, nativePreviews: true });

  assert.equal(Object.keys(baseline.tools).length, 88);
  assert.equal(Object.keys(nativeOnly.tools).length, 88);
  assert.equal(Object.keys(safe.tools).length, 96);
  assert.equal(Object.keys(safeNative.tools).length, 100);
  assert.ok(safe.registry.packageIds.includes("tiny-chu.safe-tooling"));
  assert.equal(safe.registry.packageIds.includes("tiny-chu.native-previews"), false);
  assert.ok(safeNative.registry.packageIds.includes("tiny-chu.native-previews"));
  assert.deepEqual(SAFE_TOOLING_TOOL_NAMES.filter((name) => typeof baseline.tools[name] === "function"), []);
  assert.deepEqual(SAFE_TOOLING_TOOL_NAMES.filter((name) => typeof safe.tools[name] === "function").sort(), SAFE_TOOLING_TOOL_NAMES);
  assert.deepEqual(NATIVE_PREVIEW_TOOL_NAMES.filter((name) => typeof safeNative.tools[name] === "function").sort(), NATIVE_PREVIEW_TOOL_NAMES);
  assert.equal(safe.registry.toolSpecs.find((spec) => spec.name === "safe_patch_apply")?.permission?.writesSource, true);
  assert.equal(safe.registry.toolSpecs.find((spec) => spec.name === "artifact_publish_apply")?.permission?.writesSource, true);
  assert.deepEqual(safe.registry.toolSpecs.find((spec) => spec.name === "safe_patch_check")?.inputSchema?.required, ["patch", "allowedTargets", "expectedFiles"]);
  assert.deepEqual(safe.registry.toolSpecs.find((spec) => spec.name === "artifact_publish_manifest")?.inputSchema?.required, ["workspaceRoot", "entries", "allowedTargets"]);
  assert.deepEqual(safe.registry.toolSpecs.find((spec) => spec.name === "artifact_publish_apply")?.inputSchema?.required, ["manifestPath"]);
  assert.equal(typeof hooks.tool.safe_patch_check.execute, "function");
  assert.equal(typeof hooks.tool.structural_search_ast.execute, "function");
});
