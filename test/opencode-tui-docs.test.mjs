import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("package and OpenCode config expose the Tiny-Chu TUI entrypoint", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const localConfig = JSON.parse(await readFile(".opencode/tui.json", "utf8"));
  const templateConfig = JSON.parse(await readFile("templates/opencode/tui.json", "utf8"));
  const localShim = await readFile(".opencode/plugins/tiny-chu-tui.ts", "utf8");
  const templateShim = await readFile("templates/opencode/plugins/tiny-chu-tui.ts", "utf8");
  const distTuiPlugin = await readFile("dist/opencode/tui-plugin.js", "utf8");
  const distTuiTypes = await readFile("dist/opencode/tui-plugin.d.ts", "utf8");
  const packageImport = await import("tiny-chu/tui");

  assert.equal(packageJson.exports["./tui"], "./dist/opencode/tui-plugin.js");
  assert.ok(localConfig.plugin.includes("./plugins/tiny-chu-tui.ts"));
  assert.ok(templateConfig.plugin.includes("./plugins/tiny-chu-tui.ts"));
  assert.match(localShim, /\.\.\/\.\.\/src\/opencode\/tui-plugin\.ts/);
  assert.match(templateShim, /tiny-chu\/tui/);
  assert.match(distTuiPlugin, /@opentui\/solid/);
  assert.doesNotMatch(distTuiPlugin, /solid-js/);
  assert.match(distTuiTypes, /@opencode-ai\/plugin\/tui/);
  assert.doesNotMatch(distTuiTypes, /TinyChuTuiApi|TinyChuTuiPluginModule/);
  assert.equal(packageImport.default, packageImport.TinyChuOpenCodeTuiPlugin);
  assert.equal(packageImport.default.id, "tiny-chu.logo");
});

test("docs describe the Tiny-Chu TUI dashboard instead of logo-only behavior", async () => {
  const docs = {
    readme: await readFile("README.md", "utf8"),
    howToUse: await readFile("HOW_TO_USE.md", "utf8"),
    install: await readFile("INSTALL.md", "utf8"),
  };

  for (const value of Object.values(docs)) {
    assert.match(value, /dashboard_snapshot/);
    assert.match(value, /home_prompt_right/);
    assert.match(value, /sidebar_content/);
    assert.match(value, /provider network preflight|provider\/network preflight|provider preflight/i);
    assert.doesNotMatch(value, /only replaces|home-logo-only|logo-only|home_logo` surface/);
  }
});

test("architecture docs include dashboard snapshot in current tool counts", async () => {
  const docs = {
    overview: await readFile("docs/architecture/01-overview.md", "utf8"),
    registry: await readFile("docs/architecture/02-registry-pattern.md", "utf8"),
    packages: await readFile("docs/architecture/03-feature-packages.md", "utf8"),
    catalog: await readFile("docs/architecture/04-tool-catalog.md", "utf8"),
    decisions: await readFile("docs/architecture/08-design-decisions.md", "utf8"),
  };
  const combined = Object.values(docs).join("\n");

  assert.match(combined, /기본 93개 툴/);
  assert.match(docs.packages, /tiny-chu\.small-model-resilience[\s\S]*24[\s\S]*dashboard_snapshot/);
  assert.match(docs.catalog, /dashboard_snapshot/);
  assert.match(docs.catalog, /small_model_contribution_evaluation/);
  assert.match(docs.catalog, /기본 레지스트리는 93개/);
  assert.match(docs.catalog, /safeTooling`을 켜면 101개/);
  assert.match(docs.catalog, /nativePreviews`까지 켜면 105개/);
  assert.doesNotMatch(combined, /기본 85개 툴|기본 86개 툴|기본 88개 툴|기본 92개 툴|기본 레지스트리는 85개|기본 레지스트리는 86개|기본 레지스트리는 88개|기본 레지스트리는 92개|safeTooling`을 켜면 93개|safeTooling`을 켜면 94개|safeTooling`을 켜면 96개|safeTooling`을 켜면 100개|nativePreviews`까지 켜면 97개|nativePreviews`까지 켜면 98개|nativePreviews`까지 켜면 100개|nativePreviews`까지 켜면 104개/);
});
