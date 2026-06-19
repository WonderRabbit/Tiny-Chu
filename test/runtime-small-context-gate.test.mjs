import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTinyChuPlugin } from "../dist/index.js";

const WORKER_MODE_EXCLUDED_PACKAGES = [
  "tiny-chu.public-worker-queue",
  "tiny-chu.button-workflow-dispatch",
  "tiny-chu.workflow-orchestration",
];

async function temporaryRoot(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

function packageIds(items) {
  return items.map((item) => item.id);
}

test("worker install-check reports active and excluded packages without changing mode filtering", async () => {
  const root = await temporaryRoot("tiny-chu-worker-install-check-");
  const tiny = createTinyChuPlugin({ root, mode: "worker" });
  const install = await tiny.tools.tiny_chu_install_check({});

  assert.deepEqual(packageIds(install.activePackages), tiny.registry.packageIds);
  assert.deepEqual(packageIds(install.exposedPackages), tiny.registry.packageIds);
  for (const id of WORKER_MODE_EXCLUDED_PACKAGES) {
    assert.equal(tiny.registry.packageIds.includes(id), false);
    assert.equal(install.excludedPackages.some((item) => item.id === id && item.reason === "mode"), true);
  }
  assert.equal(install.diagnostics.some((item) => item.code === "mode_excluded_package" && item.packageId === "tiny-chu.public-worker-queue"), true);
  assert.equal(install.requiredTools.includes("public_dispatch"), false);
  assert.equal(install.requiredTools.includes("workflow_next"), false);
});

test("small-context gate preserves worker packet metadata, no-live-provider policy, and qwen retry behavior", async () => {
  const root = await temporaryRoot("tiny-chu-small-context-gate-");
  const tiny = createTinyChuPlugin({ root, mode: "worker" });
  const profile = await tiny.tools.orchestration_profile({});
  const packetPlan = await tiny.tools.worker_packet_optimizer({
    objective: "finish a bounded runtime-package task",
    boundedFiles: ["src/opencode/tiny-plugin.ts", "test/runtime-package-disabling.test.mjs"],
    evidenceRefs: [".omo/evidence/task-5-tiny-chu-docs-implementation-red.txt"],
    knownUncertainties: ["none"],
    mustReturn: ["DoneClaim"],
  });
  const retry = await tiny.tools.qwen_retry_policy({ status: "failed", estimatedTokens: 21_000 });

  assert.equal(profile.smallContextRun.noLiveProviderCalls, true);
  assert.equal(profile.smallContextRun.localToolsOnly, true);
  assert.equal(profile.packetStrategy.maxContextChars, 6000);
  assert.equal(profile.packetStrategy.maxEvidenceChars, 1200);
  assert.equal(packetPlan.noLiveProviderCalls, true);
  assert.equal(packetPlan.dispatchMode, "packet_only");
  assert.equal(packetPlan.dispatch.requested, false);
  assert.deepEqual(packetPlan.dispatch.publicJobIds, []);
  assert.equal(packetPlan.packets[0].objective, "finish a bounded runtime-package task");
  assert.deepEqual(packetPlan.packets[0].mustReturn, ["DoneClaim"]);
  assert.equal(packetPlan.packets[0].retryPolicyInput.status, "queued");
  assert.equal(packetPlan.ratePlan.requestsPerMinute, 20);
  assert.equal(packetPlan.ratePlan.tokensPerMinute, 20000);
  assert.equal(retry.limits.requestsPerMinute, 20);
  assert.equal(retry.limits.tokensPerMinute, 20000);
  assert.equal(retry.shouldRetry, true);
  assert.equal(retry.recoveryProtocol.some((step) => /task_checkpoint/.test(step)), true);
});
