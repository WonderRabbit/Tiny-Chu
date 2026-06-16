import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readText(path) {
  return readFile(path, "utf8");
}

function arrayBlock(source, exportName) {
  const start = source.indexOf(`export const ${exportName}`);
  assert.notEqual(start, -1, `${exportName} is missing`);
  const end = source.indexOf("];", start);
  assert.notEqual(end, -1, `${exportName} is unterminated`);
  return source.slice(start, end);
}

function toolNamesFromBlock(block) {
  const names = [];
  for (const match of block.matchAll(/\b(?:readJson|writeSource|writeState)\("([^"]+)"/g)) {
    names.push(match[1]);
  }
  return names.sort();
}

function assertMentionsEvery(docName, docText, values) {
  const missing = values.filter((value) => !docText.includes(value));
  assert.deepEqual(missing, [], `${docName} is missing feature surface mentions`);
}

function sectionForHeading(source, heading) {
  const marker = `#### \`${heading}\``;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${heading} inventory entry is missing`);
  const next = source.indexOf("\n#### `", start + marker.length);
  return source.slice(start, next === -1 ? undefined : next);
}

function assertInventoryEntry(source, heading) {
  const section = sectionForHeading(source, heading);
  assertMentionsEvery(`${heading} inventory entry`, section, [
    "현재 상태:",
    "근거:",
    "아직 구현하지 않는 범위:",
    "향후 검토 조건:",
  ]);
}

test("safe tooling docs stay synchronized with source tool metadata", async () => {
  // Given: safe tooling and native preview tool names are declared in one source module.
  const source = await readText("src/opencode/feature-packages/default-tool-seeds.ts");
  const safeTools = toolNamesFromBlock(arrayBlock(source, "SAFE_TOOLING_TOOLS"));
  const nativePreviewTools = toolNamesFromBlock(arrayBlock(source, "NATIVE_PREVIEW_TOOLS"));
  const [readme, howToUse, toolGuide] = await Promise.all([
    readText("README.md"),
    readText("HOW_TO_USE.md"),
    readText("docs/for_tools.md"),
  ]);

  // When: public and operator docs describe the modified safe-tooling feature surface.
  // Then: docs mention every opt-in tool and the optional native executable backing JSON patch preview.
  assertMentionsEvery("README.md", readme, [...safeTools, ...nativePreviewTools, "safeTooling", "nativePreviews"]);
  assertMentionsEvery("HOW_TO_USE.md", howToUse, [...safeTools, ...nativePreviewTools, "safeTooling", "nativePreviews"]);
  assertMentionsEvery("docs/for_tools.md", toolGuide, ["nativePreviews", "json_patch_preview", "jd"]);
});

test("Korean root and installation docs expose canonical feature inventory", async () => {
  const [readme, install, howToUse, featureInventory] = await Promise.all([
    readText("README.md"),
    readText("INSTALL.md"),
    readText("HOW_TO_USE.md"),
    readText("docs/feature/2026-06-15-unimplemented-features.md"),
  ]);

  assertMentionsEvery("README.md", readme, [
    "빠른 시작",
    "설치",
    "OpenCode",
    "안전한 소스 도구",
    "아직 구현하지 않은 기능",
    "safeTooling",
    "nativePreviews",
    "INSTALL.md",
    "HOW_TO_USE.md",
    "docs/architecture/README.md",
    "docs/feature/2026-06-15-unimplemented-features.md",
  ]);

  assertMentionsEvery("INSTALL.md", install, [
    "# Tiny-Chu 설치 가이드",
    "1단계",
    "offline bundle",
    "internal registry",
    "developer local checkout",
    "release:offline",
    "verify:offline",
    ".opencode/vendor",
    "templates/opencode",
    "tiny_chu_install_check",
    "ENOTCACHED",
    "PowerShell",
    "README.md",
    "HOW_TO_USE.md",
  ]);

  assertMentionsEvery("HOW_TO_USE.md", howToUse, [
    "INSTALL.md",
    "docs/feature/2026-06-15-unimplemented-features.md",
  ]);

  assertMentionsEvery("docs/feature/2026-06-15-unimplemented-features.md", featureInventory, [
    "2026-06-15",
    "현재 상태",
    "미구현 범위",
    "근거",
    "향후 검토 조건",
    "run_tests",
    "diff_preview",
    "js_ts_codemod_preview",
    "merge_preview",
    "semantic_diff_preview",
    "delta",
    "difftastic",
    "mergiraf",
    "dynamic package discovery",
    "npm subpackage loading",
    "MCP server adapters",
    "Figma API calls",
    "provider chat/generate/completion calls",
    "runtime disabling of default feature packages",
    "cross-process file locking",
    "compact tool index",
    "ULW prompt injection follow-up",
    "content-aware packet fit",
    "long-running command recovery guide follow-up",
    "### deferred safe/source tooling",
    "### package/plugin expansion",
    "### external adapter boundaries",
    "### provider/network behavior",
    "### concurrency/state hardening",
    "### small-model optimization follow-ups",
    "### documentation/operations follow-ups",
  ]);

  for (const item of [
    "run_tests",
    "diff_preview",
    "js_ts_codemod_preview",
    "merge_preview",
    "semantic_diff_preview",
    "delta",
    "difftastic",
    "mergiraf",
    "dynamic package discovery",
    "npm subpackage loading",
    "MCP server adapters",
    "Figma API calls",
    "provider chat/generate/completion calls",
    "runtime disabling of default feature packages",
    "cross-process file locking",
    "compact tool index",
    "ULW prompt injection follow-up",
    "content-aware packet fit",
    "long-running command recovery guide follow-up",
  ]) {
    assertInventoryEntry(featureInventory, item);
  }

  assert.equal(/구현 완료|현재 사용 가능|지원됩니다|available now/i.test(featureInventory), false);
});
