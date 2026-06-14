import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import TinyChuOpenCodeTuiPluginDefault, {
  renderTinyChuHomeLogo,
  setTinyChuTuiRuntimeLoaderForTest,
  TINY_CHU_TUI_LOGO_TEXT,
  TinyChuOpenCodeTuiPlugin,
} from "../dist/opencode/tui-plugin.js";

function createFakeSolidRuntime() {
  return {
    createElement(tag) {
      return { tag, children: [] };
    },
    insert(parent, accessor) {
      parent.children.push(accessor);
      return parent;
    },
  };
}

test("Tiny-Chu TUI plugin replaces the OpenCode home logo slot", async () => {
  const registered = [];
  const runtime = createFakeSolidRuntime();
  const resetRuntimeLoader = setTinyChuTuiRuntimeLoaderForTest(async () => runtime);
  const fakeApi = {
    slots: {
      register(plugin) {
        registered.push(plugin);
        return "tiny-chu.logo.slot";
      },
    },
  };

  assert.equal(TinyChuOpenCodeTuiPluginDefault, TinyChuOpenCodeTuiPlugin);
  assert.equal(TinyChuOpenCodeTuiPluginDefault.id, "tiny-chu.logo");
  assert.equal(typeof TinyChuOpenCodeTuiPluginDefault.tui, "function");

  try {
    await TinyChuOpenCodeTuiPlugin.tui(fakeApi, undefined, {
      id: "tiny-chu.logo",
      source: "file",
      spec: "./plugins/tiny-chu-tui.ts",
      target: "tui",
      first_time: 0,
      last_time: 0,
      time_changed: 0,
      load_count: 1,
      fingerprint: "test",
      state: "first",
    });
  } finally {
    resetRuntimeLoader();
  }

  assert.equal(registered.length, 1);
  assert.equal(typeof registered[0].slots.home_logo, "function");
  const rendered = registered[0].slots.home_logo({}, {});
  assert.equal(TINY_CHU_TUI_LOGO_TEXT, "TinyChu");
  assert.notEqual(typeof rendered, "string");
  assert.deepEqual(rendered, { tag: "text", children: ["TinyChu"] });
  assert.deepEqual(renderTinyChuHomeLogo(runtime), { tag: "text", children: ["TinyChu"] });
});

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
  assert.match(distTuiTypes, /@opencode-ai\/plugin\/tui/);
  assert.doesNotMatch(distTuiTypes, /TinyChuTuiApi|TinyChuTuiPluginModule/);
  assert.equal(packageImport.default, packageImport.TinyChuOpenCodeTuiPlugin);
  assert.equal(packageImport.default.id, "tiny-chu.logo");
});
