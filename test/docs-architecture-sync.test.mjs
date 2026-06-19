import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createTinyChuPlugin } from "../dist/index.js";

async function readText(path) {
  return readFile(path, "utf8");
}

function assertMentionsEvery(docName, docText, values) {
  const missing = values.filter((value) => !docText.includes(value));
  assert.deepEqual(missing, [], `${docName} is missing registry values`);
}

function assertOmitsEvery(docName, docText, patterns) {
  const matched = patterns.filter((pattern) => pattern.test(docText));
  assert.deepEqual(matched.map(String), [], `${docName} contains stale governance claims`);
}

test("architecture docs keep package ids and default tool counts synchronized with registry", async () => {
  // Given: the composed registry is the source of truth for package and tool counts.
  const tiny = createTinyChuPlugin({ root: process.cwd() });
  const registryToolCount = tiny.registry.toolSpecs.length;
  const registryPackageCount = tiny.registry.packageIds.length;
  const [architectureReadme, featurePackages, toolCatalog, overview, registryPattern, pluginHooks, decisions, extending] = await Promise.all([
    readText("docs/architecture/README.md"),
    readText("docs/architecture/03-feature-packages.md"),
    readText("docs/architecture/04-tool-catalog.md"),
    readText("docs/architecture/01-overview.md"),
    readText("docs/architecture/02-registry-pattern.md"),
    readText("docs/architecture/05-plugin-and-hooks.md"),
    readText("docs/architecture/08-design-decisions.md"),
    readText("docs/architecture/09-extending-guide.md"),
  ]);

  // When: architecture docs describe package ids, package count, and tool count.
  // Then: every active package id appears and stale hard-coded counts are rejected.
  assert.equal(registryToolCount, 99);
  assert.equal(registryPackageCount, 14);
  assertMentionsEvery("docs/architecture/03-feature-packages.md", featurePackages, tiny.registry.packageIds);
  assertMentionsEvery("docs/architecture/04-tool-catalog.md", toolCatalog, tiny.registry.packageIds);
  assertMentionsEvery("docs/architecture/README.md", architectureReadme, ["14개 기본 패키지", "기본 99개 툴"]);
  assertMentionsEvery("docs/architecture/03-feature-packages.md", featurePackages, ["mode 2 기준 14개"]);
  assertMentionsEvery("docs/architecture/04-tool-catalog.md", toolCatalog, ["기본 99개 툴", "safeTooling", "107개", "111개"]);

  for (const [docName, docText] of [
    ["docs/architecture/01-overview.md", overview],
    ["docs/architecture/02-registry-pattern.md", registryPattern],
    ["docs/architecture/03-feature-packages.md", featurePackages],
    ["docs/architecture/04-tool-catalog.md", toolCatalog],
    ["docs/architecture/05-plugin-and-hooks.md", pluginHooks],
    ["docs/architecture/08-design-decisions.md", decisions],
    ["docs/architecture/09-extending-guide.md", extending],
  ]) {
    assertOmitsEvery(docName, docText, [
      /기본\s*93개/,
      /기본\s*94개/,
      /93개\s*(?:툴|tool|핸들러)/i,
      /94개\s*(?:툴|tool|핸들러)/i,
      /12개\s*기본\s*패키지/,
      /mode 2 기준 12개/,
      /기본 레지스트리는 93개/,
      /기본 레지스트리는 94개/,
      /101개/,
      /105개/,
      /102개/,
      /106개/,
    ]);
  }
});

test("root and architecture docs use registry-valid tool names for public usage surfaces", async () => {
  // Given: public docs name tools that users may call through OpenCode or direct API.
  const tiny = createTinyChuPlugin({ root: process.cwd(), safeTooling: true, nativePreviews: true });
  const result = await tiny.tools.docs_consistency_check({
    paths: [
      "README.md",
      "HOW_TO_USE.md",
      "INSTALL.md",
      "docs/architecture/01-overview.md",
      "docs/architecture/02-registry-pattern.md",
      "docs/architecture/03-feature-packages.md",
      "docs/architecture/04-tool-catalog.md",
      "docs/architecture/05-plugin-and-hooks.md",
      "docs/architecture/08-design-decisions.md",
      "docs/architecture/09-extending-guide.md",
    ],
  });

  // When: the docs consistency checker compares those docs to the active registry.
  // Then: docs only claim current tools.
  assert.equal(result.registryToolCount, tiny.registry.toolSpecs.length);
  assert.deepEqual(result.findings, []);
  assert.equal(result.status, "pass");
});

test("artifact publish hardening requirements are locked by regression coverage", async () => {
  // Given: artifact publish production code should not be rewritten unless a missing guard is exposed.
  const [artifactTest, workspaceSource, publishSource] = await Promise.all([
    readText("test/artifact-workspace.test.mjs"),
    readText("src/opencode/artifact-workspace.ts"),
    readText("src/opencode/artifact-publish.ts"),
  ]);

  // When: governance checks the artifact publish requirement matrix.
  // Then: existing tests cover prepared workspace, allowlist, hash, rollback, forged, symlink, malformed manifest, and lock behavior.
  assertMentionsEvery("test/artifact-workspace.test.mjs", artifactTest, [
    "isolated git workspace outside source root",
    "rejects empty allowlists and escaping inputs",
    "allowlisted hash-checked operations",
    "reject forged unprepared workspace inputs",
    "rolls back when a multi-file publish write fails",
    "rejects workspace symlink sources",
    "rejects malformed manifests",
    "refuses when the safe tooling lock is already held",
  ]);
  assertMentionsEvery("src/opencode/artifact-workspace.ts", workspaceSource, ["isPreparedArtifactWorkspace", "normalizeSafeRelativePath", "readWorkspaceFile"]);
  assertMentionsEvery("src/opencode/artifact-publish.ts", publishSource, ["stale_hash", "workspace_source_changed", "publish_write_failed", "untrusted_manifest"]);
});
