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

test("Tiny-Chu TUI plugin clips long ASCII and CJK slot text by display columns", async () => {
  const runtime = createFakeSolidRuntime();
  const fake = createFakeApi({ worktree: "/worktree/root" });
  const fakeTimer = createFakeTimer();
  const base = createSnapshot();
  const longText = "long-status-".repeat(40);
  const cjkText = "에이전트오케스트레이션현황및미래".repeat(20);
  const resetRuntimeLoader = setTinyChuTuiRuntimeLoaderForTest(async () => runtime);
  const resetSnapshotLoader = setTinyChuDashboardSnapshotLoaderForTest(async () => createSnapshot({
    task: {
      ...base.task,
      title: cjkText,
      openQuestions: [cjkText],
      evidenceRefs: [longText],
    },
    workflow: {
      ...base.workflow,
      statusLine: cjkText,
    },
    evidence: {
      ...base.evidence,
      warnings: [cjkText],
      verificationCommands: [longText],
    },
    publicJobs: {
      ...base.publicJobs,
      nextRetryAt: longText,
    },
    interrupts: [],
  }));
  const resetTimer = setTinyChuTuiTimerForTest(fakeTimer.timer);

  try {
    await TinyChuOpenCodeTuiPlugin.tui(fake.api, undefined, pluginMeta());
    await flushAsync();
  } finally {
    resetTimer();
    resetSnapshotLoader();
    resetRuntimeLoader();
  }

  const slot = fake.registered[0].slots;
  const rendered = [
    slot.home_prompt_right({}, {}),
    slot.sidebar_title({}, {}),
    slot.sidebar_content({}, {}),
    slot.sidebar_footer({}, {}),
    slot.home_bottom({}, {}),
  ].flatMap((value) => renderedText(value).split("\n"));

  for (const line of rendered) {
    assert.ok(tinyChuDisplayColumns(line) <= 76, `${tinyChuDisplayColumns(line)} columns: ${line}`);
  }
});
