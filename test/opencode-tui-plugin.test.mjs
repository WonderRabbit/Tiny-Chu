import assert from "node:assert/strict";
import test from "node:test";
import TinyChuOpenCodeTuiPluginDefault, {
  renderTinyChuHomeLogo,
  setTinyChuDashboardSnapshotLoaderForTest,
  setTinyChuTuiRuntimeLoaderForTest,
  setTinyChuTuiTimerForTest,
  TINY_CHU_TUI_LOGO_TEXT,
  TinyChuOpenCodeTuiPlugin,
} from "../dist/opencode/tui-plugin.js";
import {
  createDeferred,
  createFakeApi,
  createFakeSolidRuntime,
  createFakeTimer,
  createSnapshot,
  EXPECTED_SLOTS,
  flushAsync,
  pluginMeta,
  renderedText,
} from "./opencode-tui-test-helpers.mjs";

test("Tiny-Chu TUI plugin renders dashboard slots without registering routes", async () => {
  const runtime = createFakeSolidRuntime();
  const fake = createFakeApi({ worktree: "/worktree/root", directory: "/directory/root" });
  const fakeTimer = createFakeTimer();
  const loaderCalls = [];
  const resetRuntimeLoader = setTinyChuTuiRuntimeLoaderForTest(async () => runtime);
  const resetSnapshotLoader = setTinyChuDashboardSnapshotLoaderForTest(async (root, input) => {
    loaderCalls.push({ root, input });
    return createSnapshot();
  });
  const resetTimer = setTinyChuTuiTimerForTest(fakeTimer.timer);

  assert.equal(TinyChuOpenCodeTuiPluginDefault, TinyChuOpenCodeTuiPlugin);
  assert.equal(TinyChuOpenCodeTuiPluginDefault.id, "tiny-chu.logo");
  assert.equal(typeof TinyChuOpenCodeTuiPluginDefault.tui, "function");

  try {
    await TinyChuOpenCodeTuiPlugin.tui(fake.api, { root: "/options/root", runId: "W-1", mode: 2, refreshMs: 10 }, pluginMeta());
    await flushAsync();
  } finally {
    resetTimer();
    resetSnapshotLoader();
    resetRuntimeLoader();
  }

  assert.equal(loaderCalls[0].root, "/options/root");
  assert.equal(loaderCalls[0].input.runId, "W-1");
  assert.equal(loaderCalls[0].input.mode, 2);
  assert.equal(loaderCalls[0].input.includeProviderPreflight, false);
  assert.equal(fake.routes.length, 0);
  assert.equal(fake.registered.length, 1);
  assert.deepEqual(Object.keys(fake.registered[0].slots).sort(), EXPECTED_SLOTS);
  assert.equal(fake.registered[0].slots.app, undefined);
  assert.equal(fake.registered[0].slots.app_bottom, undefined);

  const slot = fake.registered[0].slots;
  assert.deepEqual(renderTinyChuHomeLogo(runtime), { tag: "text", children: ["TinyChu"] });
  assert.equal(renderedText(slot.home_logo({}, {})), "TinyChu");
  assert.match(renderedText(slot.home_prompt_right({}, {})), /orchestrator_worker/);
  assert.match(renderedText(slot.home_prompt_right({}, {})), /qwen3\.6-35b-a3b/);
  assert.match(renderedText(slot.home_prompt_right({}, {})), /ctx unknown/);
  assert.match(renderedText(slot.sidebar_title({}, {})), /Implement dashboard/);
  assert.match(renderedText(slot.sidebar_content({}, {})), /jobs 3/);
  assert.match(renderedText(slot.sidebar_content({}, {})), /workflow active/);
  assert.match(renderedText(slot.sidebar_content({}, {})), /Open question/);
  assert.match(renderedText(slot.sidebar_footer({}, {})), /health attention/);
  assert.match(renderedText(slot.sidebar_footer({}, {})), /retryable 1/);
  assert.match(renderedText(slot.home_bottom({}, {})), /TinyChu/);
  assert.equal(TINY_CHU_TUI_LOGO_TEXT, "TinyChu");
});

test("Tiny-Chu TUI plugin renders loading text before the first snapshot resolves", async () => {
  const runtime = createFakeSolidRuntime();
  const fake = createFakeApi({ worktree: "/worktree/root" });
  const fakeTimer = createFakeTimer();
  const deferred = createDeferred();
  const resetRuntimeLoader = setTinyChuTuiRuntimeLoaderForTest(async () => runtime);
  const resetSnapshotLoader = setTinyChuDashboardSnapshotLoaderForTest(async () => deferred.promise);
  const resetTimer = setTinyChuTuiTimerForTest(fakeTimer.timer);

  try {
    await TinyChuOpenCodeTuiPlugin.tui(fake.api, undefined, pluginMeta());
    const slot = fake.registered[0].slots;
    const content = slot.sidebar_content({}, {});
    assert.equal(renderedText(content), "TinyChu status loading");
    deferred.resolve(createSnapshot());
    await flushAsync();
    assert.match(renderedText(content), /Implement dashboard/);
  } finally {
    resetTimer();
    resetSnapshotLoader();
    resetRuntimeLoader();
  }
});
