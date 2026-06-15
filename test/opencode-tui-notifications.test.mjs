import assert from "node:assert/strict";
import test from "node:test";
import {
  setTinyChuDashboardSnapshotLoaderForTest,
  setTinyChuTuiRuntimeLoaderForTest,
  setTinyChuTuiTimerForTest,
  tinyChuDisplayColumns,
  TinyChuOpenCodeTuiPlugin,
} from "../dist/opencode/tui-plugin.js";
import {
  createFakeApi,
  createFakeSolidRuntime,
  createFakeTimer,
  createSnapshot,
  flushAsync,
  pluginMeta,
  renderedText,
} from "./opencode-tui-test-helpers.mjs";

test("Tiny-Chu TUI plugin renders degraded text when snapshot loading fails", async () => {
  const runtime = createFakeSolidRuntime();
  const fake = createFakeApi({ worktree: "/worktree/root" });
  const fakeTimer = createFakeTimer();
  const resetRuntimeLoader = setTinyChuTuiRuntimeLoaderForTest(async () => runtime);
  const resetSnapshotLoader = setTinyChuDashboardSnapshotLoaderForTest(async () => {
    throw new Error("dashboard snapshot failed " + "x".repeat(300));
  });
  const resetTimer = setTinyChuTuiTimerForTest(fakeTimer.timer);

  try {
    await TinyChuOpenCodeTuiPlugin.tui(fake.api, undefined, pluginMeta());
    await flushAsync();
  } finally {
    resetTimer();
    resetSnapshotLoader();
    resetRuntimeLoader();
  }

  const text = renderedText(fake.registered[0].slots.sidebar_content({}, {}));
  assert.match(text, /TinyChu status degraded/);
  assert.ok(tinyChuDisplayColumns(text) <= 76, `${tinyChuDisplayColumns(text)} columns: ${text}`);
});

test("Tiny-Chu TUI plugin dedupes dashboard interrupt notifications", async () => {
  const runtime = createFakeSolidRuntime();
  const fake = createFakeApi({ worktree: "/worktree/root" });
  const fakeTimer = createFakeTimer();
  const snapshots = [
    createSnapshot({
      interrupts: [
        { key: "task.blocked.T-1", severity: "danger", title: "Task blocked", message: "Blocked task" },
        { key: "public_jobs.retryable", severity: "warning", title: "Retryable jobs", message: "Retry job" },
        { key: "workflow.stalled.W-1", severity: "warning", title: "Workflow stale", message: "Stale workflow" },
        { key: "task.open_questions.T-1", severity: "warning", title: "Open questions", message: "Open question" },
        { key: "task.done.T-2", severity: "success", title: "Task complete", message: "Done task" },
        { key: "hint.info", severity: "info", title: "Hint", message: "Low priority hint" },
      ],
    }),
    createSnapshot({
      interrupts: [
        { key: "task.blocked.T-1", severity: "danger", title: "Task blocked", message: "Blocked task" },
        { key: "public_jobs.retryable", severity: "warning", title: "Retryable jobs", message: "Retry job" },
      ],
    }),
    createSnapshot({
      interrupts: [
        { key: "task.blocked.T-3", severity: "danger", title: "Task blocked", message: "New blocked task" },
      ],
    }),
  ];
  let index = 0;
  const resetRuntimeLoader = setTinyChuTuiRuntimeLoaderForTest(async () => runtime);
  const resetSnapshotLoader = setTinyChuDashboardSnapshotLoaderForTest(async () => snapshots[Math.min(index++, snapshots.length - 1)]);
  const resetTimer = setTinyChuTuiTimerForTest(fakeTimer.timer);

  try {
    await TinyChuOpenCodeTuiPlugin.tui(fake.api, undefined, pluginMeta());
    await flushAsync();
    assert.equal(fake.attentions.length, 1);
    assert.equal(fake.toasts.length, 4);
    await fakeTimer.intervals[0].callback();
    assert.equal(fake.attentions.length, 1);
    assert.equal(fake.toasts.length, 4);
    await fakeTimer.intervals[0].callback();
    assert.equal(fake.attentions.length, 2);
    assert.equal(fake.toasts.length, 4);
  } finally {
    resetTimer();
    resetSnapshotLoader();
    resetRuntimeLoader();
  }
});
