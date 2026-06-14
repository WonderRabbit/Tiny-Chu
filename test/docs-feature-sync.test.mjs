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
