import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRunDiagnostics } from "../dist/index.js";

function runnerFor(results) {
  return async (command, args) => {
    const key = `${command} ${args.join(" ")}`;
    return results[key] ?? { status: "ok", command, args, exitCode: 0, stdout: "", stderr: "", timedOut: false };
  };
}

test("run_diagnostics prefers build then test scripts and stays advisory", async () => {
  // Given: a package with build and test scripts.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-diagnostics-ok-"));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { build: "tsc", test: "node --test" } }), "utf8");
  const runner = runnerFor({
    "npm run build": { status: "ok", command: "npm", args: ["run", "build"], exitCode: 0, stdout: "build ok", stderr: "", timedOut: false },
    "npm test": { status: "ok", command: "npm", args: ["test"], exitCode: 0, stdout: "test ok", stderr: "", timedOut: false },
  });

  // When: diagnostics run.
  const result = await createRunDiagnostics(root, { runner });

  // Then: command order is deterministic and advisory.
  assert.equal(result.status, "passed");
  assert.equal(result.gatesMutation, false);
  assert.equal(result.recommendedBeforePublish, true);
  assert.deepEqual(result.commands.map((item) => item.commandLine), ["npm run build", "npm test"]);
});

test("run_diagnostics degrades for missing scripts and fails for command errors", async () => {
  // Given: packages with missing and failing scripts.
  const missingRoot = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-diagnostics-missing-"));
  await writeFile(path.join(missingRoot, "package.json"), JSON.stringify({ scripts: {} }), "utf8");
  const failingRoot = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-diagnostics-fail-"));
  await writeFile(path.join(failingRoot, "package.json"), JSON.stringify({ scripts: { build: "tsc" } }), "utf8");
  const runner = runnerFor({
    "npm run build": { status: "ok", command: "npm", args: ["run", "build"], exitCode: 2, stdout: "", stderr: "boom", timedOut: false },
  });

  // When: diagnostics run.
  const missing = await createRunDiagnostics(missingRoot, { runner });
  const failed = await createRunDiagnostics(failingRoot, { runner });

  // Then: missing scripts are degraded and nonzero commands fail.
  assert.equal(missing.status, "degraded");
  assert.equal(failed.status, "failed");
  assert.equal(failed.commands[0].exitCode, 2);
});

test("run_diagnostics reports malformed package json and missing package json", async () => {
  // Given: invalid and absent package manifests.
  const malformedRoot = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-diagnostics-bad-"));
  await writeFile(path.join(malformedRoot, "package.json"), "{bad", "utf8");
  const absentRoot = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-diagnostics-absent-"));
  await mkdir(path.join(absentRoot, "src"));

  // When: diagnostics run.
  const malformed = await createRunDiagnostics(malformedRoot, { runner: runnerFor({}) });
  const absent = await createRunDiagnostics(absentRoot, { runner: runnerFor({}) });

  // Then: both outcomes are degraded, not thrown.
  assert.equal(malformed.status, "degraded");
  assert.equal(absent.status, "degraded");
});
