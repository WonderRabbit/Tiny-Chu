import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTinyChuPlugin } from "../dist/index.js";

const SNAPSHOT_KEYS = [
  "schemaVersion",
  "generatedAt",
  "root",
  "packageName",
  "version",
  "runtimeMode",
  "packageIds",
  "toolNames",
  "nativeTools",
  "docs",
  "stateRefs",
];

async function tempRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-project-snapshot-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({ name: "fixture-project", version: "9.8.7" }, null, 2)}\n`);
  await writeFile(path.join(root, "README.md"), "OpenCode tool list: `task_create`, `context_bundle`.\n");
  return root;
}

function expectedSummary(snapshot) {
  return [
    "# Tiny-Chu Project Snapshot",
    "",
    "This summary is generated only from `.tiny/project/snapshot.json`.",
    "",
    `- Schema version: ${snapshot.schemaVersion}`,
    `- Generated at: ${snapshot.generatedAt}`,
    `- Root: ${snapshot.root}`,
    `- Package: ${snapshot.packageName}@${snapshot.version}`,
    `- Runtime mode: ${snapshot.runtimeMode}`,
    `- Packages: ${snapshot.packageIds.length}`,
    `- Tools: ${snapshot.toolNames.length}`,
    `- Native tools: ${snapshot.nativeTools.length === 0 ? "none" : snapshot.nativeTools.join(", ")}`,
    `- Docs tracked: ${snapshot.docs.length}`,
    "",
    "## Package IDs",
    "",
    ...snapshot.packageIds.map((id) => `- ${id}`),
    "",
    "## Tool Names",
    "",
    ...snapshot.toolNames.map((name) => `- ${name}`),
    "",
    "## State Refs",
    "",
    ...Object.entries(snapshot.stateRefs).map(([key, value]) => `- ${key}: ${value}`),
    "",
  ].join("\n");
}

test("project_snapshot writes exact project snapshot files from registry metadata", async (t) => {
  // Given: a Tiny-Chu plugin rooted at a project with package metadata.
  const root = await tempRoot(t);
  const tiny = createTinyChuPlugin({ root, mode: "worker" });

  // When: the project snapshot tool writes its JSON and Markdown projection.
  const result = await tiny.tools.project_snapshot({ generatedAt: "2026-01-02T03:04:05.000Z" });

  // Then: only the required project snapshot paths are reported and the JSON schema fields are stable.
  assert.deepEqual(result.paths, [".tiny/project/snapshot.json", ".tiny/project/summary.md"]);
  const snapshotText = await readFile(path.join(root, ".tiny/project/snapshot.json"), "utf8");
  const summaryText = await readFile(path.join(root, ".tiny/project/summary.md"), "utf8");
  const snapshot = JSON.parse(snapshotText);

  assert.deepEqual(Object.keys(snapshot), SNAPSHOT_KEYS);
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.generatedAt, "2026-01-02T03:04:05.000Z");
  assert.equal(snapshot.root, root);
  assert.equal(snapshot.packageName, "fixture-project");
  assert.equal(snapshot.version, "9.8.7");
  assert.equal(snapshot.runtimeMode, "worker");
  assert.deepEqual(snapshot.packageIds, [...snapshot.packageIds].sort());
  assert.deepEqual(snapshot.toolNames, [...snapshot.toolNames].sort());
  assert.deepEqual(snapshot.nativeTools, [...snapshot.nativeTools].sort());
  assert.ok(snapshot.packageIds.includes("tiny-chu.core-runtime"));
  assert.ok(snapshot.toolNames.includes("task_create"));
  assert.deepEqual(snapshot.stateRefs, {
    tasks: ".tiny/tasks",
    plans: ".tiny/plans",
    publicJobs: ".tiny/public-jobs",
    workflows: ".tiny/workflows",
    wikiIndex: ".tiny/wiki/index.json",
    projectSnapshot: ".tiny/project/snapshot.json",
    projectSummary: ".tiny/project/summary.md",
  });
  assert.equal(summaryText, expectedSummary(snapshot));
});

test("project_snapshot regenerates deterministic projections for the same registry state", async (t) => {
  // Given: the same root, registry, and generated timestamp.
  const root = await tempRoot(t);
  const tiny = createTinyChuPlugin({ root });

  // When: the project snapshot tool runs twice.
  await tiny.tools.project_snapshot({ generatedAt: "2026-01-02T03:04:05.000Z" });
  const firstSnapshot = await readFile(path.join(root, ".tiny/project/snapshot.json"), "utf8");
  const firstSummary = await readFile(path.join(root, ".tiny/project/summary.md"), "utf8");
  await tiny.tools.project_snapshot({ generatedAt: "2026-01-02T03:04:05.000Z" });

  // Then: stale state is replaced with byte-identical JSON and summary output.
  assert.equal(await readFile(path.join(root, ".tiny/project/snapshot.json"), "utf8"), firstSnapshot);
  assert.equal(await readFile(path.join(root, ".tiny/project/summary.md"), "utf8"), firstSummary);
});

test("project_snapshot ignores package metadata when package.json is a symlink escape", async (t) => {
  // Given: package.json inside the project points at metadata outside the configured root.
  const parent = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-project-snapshot-link-"));
  t.after(async () => {
    await rm(parent, { recursive: true, force: true });
  });
  const root = path.join(parent, "repo");
  const outside = path.join(parent, "outside-package.json");
  await mkdir(root, { recursive: true });
  await writeFile(outside, `${JSON.stringify({ name: "outside-secret-package", version: "9.9.9" })}\n`, "utf8");
  await symlink(outside, path.join(root, "package.json"));
  await writeFile(path.join(root, "README.md"), "OpenCode tool list: `task_create`.\n");
  const tiny = createTinyChuPlugin({ root });

  // When: the snapshot is generated through the plugin tool surface.
  const result = await tiny.tools.project_snapshot({ generatedAt: "2026-01-02T03:04:05.000Z" });

  // Then: outside package metadata is not read or persisted.
  assert.equal(result.snapshot.packageName, "unknown");
  assert.equal(result.snapshot.version, "0.0.0");
  assert.doesNotMatch(await readFile(path.join(root, ".tiny/project/snapshot.json"), "utf8"), /outside-secret-package|9\.9\.9/);
});
