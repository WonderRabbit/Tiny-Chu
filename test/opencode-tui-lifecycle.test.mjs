import assert from "node:assert/strict";
import test from "node:test";
import {
  setTinyChuDashboardSnapshotLoaderForTest,
  setTinyChuTuiRuntimeLoaderForTest,
  setTinyChuTuiTimerForTest,
  TinyChuOpenCodeTuiPlugin,
} from "../dist/opencode/tui-plugin.js";
import {
  createDeferred,
  createFakeApi,
  createFakeSolidRuntime,
  createFakeTimer,
  createSnapshot,
  flushAsync,
  pluginMeta,
  renderedText,
} from "./opencode-tui-test-helpers.mjs";

test("Tiny-Chu TUI plugin resolves root from options, worktree, directory, then cwd", async () => {
  const runtime = createFakeSolidRuntime();
  const fakeTimer = createFakeTimer();
  const roots = [];
  const resetRuntimeLoader = setTinyChuTuiRuntimeLoaderForTest(async () => runtime);
  const resetSnapshotLoader = setTinyChuDashboardSnapshotLoaderForTest(async (root) => {
    roots.push(root);
    return createSnapshot();
  });
  const resetTimer = setTinyChuTuiTimerForTest(fakeTimer.timer);

  try {
    await TinyChuOpenCodeTuiPlugin.tui(createFakeApi({ worktree: "/worktree/root", directory: "/directory/root" }).api, { root: "/options/root" }, pluginMeta());
    await TinyChuOpenCodeTuiPlugin.tui(createFakeApi({ worktree: "/worktree/root", directory: "/directory/root" }).api, undefined, pluginMeta());
    await TinyChuOpenCodeTuiPlugin.tui(createFakeApi({ directory: "/directory/root" }).api, undefined, pluginMeta());
    await TinyChuOpenCodeTuiPlugin.tui(createFakeApi({}).api, undefined, pluginMeta());
  } finally {
    resetTimer();
    resetSnapshotLoader();
    resetRuntimeLoader();
  }

  assert.deepEqual(roots, ["/options/root", "/worktree/root", "/directory/root", process.cwd()]);
});

test("Tiny-Chu TUI plugin clears refresh interval through lifecycle disposal", async () => {
  const runtime = createFakeSolidRuntime();
  const fake = createFakeApi({ worktree: "/worktree/root" });
  const fakeTimer = createFakeTimer();
  const resetRuntimeLoader = setTinyChuTuiRuntimeLoaderForTest(async () => runtime);
  const resetSnapshotLoader = setTinyChuDashboardSnapshotLoaderForTest(async () => createSnapshot());
  const resetTimer = setTinyChuTuiTimerForTest(fakeTimer.timer);

  try {
    await TinyChuOpenCodeTuiPlugin.tui(fake.api, { refreshMs: 25 }, pluginMeta());
    assert.equal(fakeTimer.intervals.length, 1);
    assert.equal(fakeTimer.intervals[0].ms, 25);
    assert.equal(fake.disposeCallbacks.length, 1);
    await fake.disposeCallbacks[0]();
  } finally {
    resetTimer();
    resetSnapshotLoader();
    resetRuntimeLoader();
  }

  assert.deepEqual(fakeTimer.cleared, [fakeTimer.intervals[0]]);
});

test("Tiny-Chu TUI plugin refreshes visible slot text after interval updates", async () => {
  const runtime = createFakeSolidRuntime();
  const fake = createFakeApi({ worktree: "/worktree/root" });
  const fakeTimer = createFakeTimer();
  const snapshots = [
    createSnapshot({
      task: { ...createSnapshot().task, title: "Initial dashboard" },
      status: "attention",
    }),
    createSnapshot({
      task: { ...createSnapshot().task, title: "Refreshed dashboard" },
      status: "healthy",
      publicJobs: { total: 0, retryable: 0, byStatus: [] },
      interrupts: [],
    }),
  ];
  let index = 0;
  const resetRuntimeLoader = setTinyChuTuiRuntimeLoaderForTest(async () => runtime);
  const resetSnapshotLoader = setTinyChuDashboardSnapshotLoaderForTest(async () => snapshots[Math.min(index++, snapshots.length - 1)]);
  const resetTimer = setTinyChuTuiTimerForTest(fakeTimer.timer);

  try {
    await TinyChuOpenCodeTuiPlugin.tui(fake.api, { refreshMs: 25 }, pluginMeta());
    await flushAsync();
    const title = fake.registered[0].slots.sidebar_title({}, {});
    assert.match(renderedText(title), /Initial dashboard/);
    await fakeTimer.intervals[0].callback();
    assert.match(renderedText(title), /Refreshed dashboard/);
    assert.match(renderedText(fake.registered[0].slots.sidebar_footer({}, {})), /health healthy/);
  } finally {
    resetTimer();
    resetSnapshotLoader();
    resetRuntimeLoader();
  }

  assert.ok(fake.renderRequests.length >= 2);
});

test("Tiny-Chu TUI plugin ignores stale overlapping refresh results", async () => {
  const runtime = createFakeSolidRuntime();
  const fake = createFakeApi({ worktree: "/worktree/root" });
  const fakeTimer = createFakeTimer();
  const slow = createDeferred();
  const resetRuntimeLoader = setTinyChuTuiRuntimeLoaderForTest(async () => runtime);
  let callCount = 0;
  const resetSnapshotLoader = setTinyChuDashboardSnapshotLoaderForTest(async () => {
    callCount += 1;
    if (callCount === 1) return slow.promise;
    return createSnapshot({
      task: { ...createSnapshot().task, title: "Fresh dashboard" },
      status: "healthy",
      publicJobs: { total: 0, retryable: 0, byStatus: [] },
      interrupts: [],
    });
  });
  const resetTimer = setTinyChuTuiTimerForTest(fakeTimer.timer);

  try {
    await TinyChuOpenCodeTuiPlugin.tui(fake.api, undefined, pluginMeta());
    const title = fake.registered[0].slots.sidebar_title({}, {});
    assert.equal(renderedText(title), "TinyChu status loading");
    await fakeTimer.intervals[0].callback();
    assert.match(renderedText(title), /Fresh dashboard/);
    slow.resolve(createSnapshot({ task: { ...createSnapshot().task, title: "Stale dashboard" } }));
    await flushAsync();
    assert.match(renderedText(title), /Fresh dashboard/);
    assert.doesNotMatch(renderedText(title), /Stale dashboard/);
  } finally {
    resetTimer();
    resetSnapshotLoader();
    resetRuntimeLoader();
  }
});

test("Tiny-Chu TUI plugin ignores pending refresh completion after dispose", async () => {
  const runtime = createFakeSolidRuntime();
  const fake = createFakeApi({ worktree: "/worktree/root" });
  const fakeTimer = createFakeTimer();
  const pending = createDeferred();
  const resetRuntimeLoader = setTinyChuTuiRuntimeLoaderForTest(async () => runtime);
  const resetSnapshotLoader = setTinyChuDashboardSnapshotLoaderForTest(async () => pending.promise);
  const resetTimer = setTinyChuTuiTimerForTest(fakeTimer.timer);

  try {
    await TinyChuOpenCodeTuiPlugin.tui(fake.api, undefined, pluginMeta());
    const content = fake.registered[0].slots.sidebar_content({}, {});
    assert.equal(renderedText(content), "TinyChu status loading");
    const renderCountBeforeDispose = fake.renderRequests.length;
    await fake.disposeCallbacks[0]();
    pending.resolve(createSnapshot({
      interrupts: [{ key: "task.done.after-dispose", severity: "success", title: "Done", message: "Should not emit" }],
    }));
    await flushAsync();
    assert.equal(renderedText(content), "TinyChu status loading");
    assert.equal(fake.renderRequests.length, renderCountBeforeDispose);
    assert.equal(fake.toasts.length, 0);
    assert.equal(fake.attentions.length, 0);
  } finally {
    resetTimer();
    resetSnapshotLoader();
    resetRuntimeLoader();
  }
});
