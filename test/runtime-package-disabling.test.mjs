import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTinyChuPlugin } from "../dist/index.js";
import { FeaturePackageError } from "../dist/opencode/feature-package.js";
import { TinyChuOpenCodePlugin } from "../dist/opencode/plugin.js";

function fakeOpenCodeInput(root) {
  return {
    project: { root },
    directory: root,
    worktree: root,
    client: { app: { log: async () => undefined } },
    $: async () => undefined,
  };
}

function fakeToolContext(root) {
  return {
    sessionID: "s1",
    messageID: "m1",
    agent: "test",
    directory: root,
    worktree: root,
    abort: new AbortController().signal,
    metadata: () => undefined,
    ask: async () => undefined,
  };
}

async function temporaryRoot(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function readOpenCodeInstallCheck(hooks, root) {
  const result = await hooks.tool.tiny_chu_install_check.execute({ input: {} }, fakeToolContext(root));
  return JSON.parse(result.output);
}

function packageIds(items) {
  return items.map((item) => item.id);
}

test("explicit disabledPackages removes optional packages from direct and OpenCode registries", async () => {
  const root = await temporaryRoot("tiny-chu-disabled-package-");
  const disabledPackages = ["tiny-chu.ux-reverse-engineering"];
  const tiny = createTinyChuPlugin({ root, disabledPackages });
  const hooks = await TinyChuOpenCodePlugin(fakeOpenCodeInput(root), { disabledPackages });
  const install = await tiny.tools.tiny_chu_install_check({});
  const bridgeInstall = await readOpenCodeInstallCheck(hooks, root);

  assert.equal(tiny.registry.packageIds.includes("tiny-chu.ux-reverse-engineering"), false);
  assert.equal(typeof tiny.tools.ux_reverse_report, "undefined");
  assert.equal(typeof hooks.tool.ux_reverse_report, "undefined");
  assert.deepEqual(install.disabledPackages, disabledPackages);
  assert.deepEqual(bridgeInstall.disabledPackages, disabledPackages);
  assert.deepEqual(packageIds(install.activePackages), tiny.registry.packageIds);
  assert.deepEqual(packageIds(install.exposedPackages), tiny.registry.packageIds);
  assert.deepEqual(packageIds(bridgeInstall.activePackages), tiny.registry.packageIds);
  assert.equal(install.excludedPackages.some((item) => item.id === "tiny-chu.ux-reverse-engineering" && item.reason === "disabled"), true);
  assert.equal(bridgeInstall.excludedPackages.some((item) => item.id === "tiny-chu.ux-reverse-engineering" && item.reason === "disabled"), true);
  assert.equal(install.diagnostics.some((item) => item.code === "package_disabled" && item.packageId === "tiny-chu.ux-reverse-engineering"), true);
  assert.deepEqual(install.requiredTools, [...install.requiredTools].sort());
});

test("disabledPackages rejects malformed input and hidden required dependencies deterministically", async () => {
  const root = await temporaryRoot("tiny-chu-disabled-package-errors-");
  const cases = [
    {
      disabledPackages: ["tiny-chu.missing"],
      code: "unknown_package",
      message: /unknown package tiny-chu\.missing/,
    },
    {
      disabledPackages: ["tiny-chu.ux-reverse-engineering", "tiny-chu.ux-reverse-engineering"],
      code: "duplicate_disabled_package",
      message: /Duplicate disabled package id: tiny-chu\.ux-reverse-engineering/,
    },
    {
      disabledPackages: ["tiny-chu.core-runtime"],
      code: "required_package_disabled",
      message: /Required package tiny-chu\.core-runtime cannot be disabled/,
    },
    {
      disabledPackages: ["tiny-chu.public-worker-queue"],
      code: "dependency_disabled",
      message: /Package tiny-chu\.button-workflow-dispatch requires disabled package tiny-chu\.public-worker-queue/,
    },
  ];

  for (const item of cases) {
    assert.throws(
      () => createTinyChuPlugin({ root, disabledPackages: item.disabledPackages }),
      (error) => error instanceof FeaturePackageError && error.code === item.code && item.message.test(error.message),
    );
  }
}
);

test("safe tooling package disabling validates dependency closure", async () => {
  const root = await temporaryRoot("tiny-chu-disabled-safe-tooling-");
  const nativeDisabled = createTinyChuPlugin({
    root,
    safeTooling: true,
    nativePreviews: true,
    disabledPackages: ["tiny-chu.native-previews"],
  });
  const install = await nativeDisabled.tools.tiny_chu_install_check({});

  assert.equal(nativeDisabled.registry.packageIds.includes("tiny-chu.safe-tooling"), true);
  assert.equal(nativeDisabled.registry.packageIds.includes("tiny-chu.native-previews"), false);
  assert.equal(install.excludedPackages.some((item) => item.id === "tiny-chu.native-previews" && item.reason === "disabled"), true);
  assert.throws(
    () => createTinyChuPlugin({
      root,
      safeTooling: true,
      nativePreviews: true,
      disabledPackages: ["tiny-chu.safe-tooling"],
    }),
    (error) => error instanceof FeaturePackageError
      && error.code === "dependency_disabled"
      && /Package tiny-chu\.native-previews requires disabled package tiny-chu\.safe-tooling/.test(error.message),
  );
});
