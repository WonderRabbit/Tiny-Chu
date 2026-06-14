import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { runStabilityPerformanceBaseline } from "../scripts/stability-performance-baseline.mjs";

const execFileAsync = promisify(execFile);

test("context wiki task and public job baseline captures deterministic counts", async () => {
  const baseline = await runStabilityPerformanceBaseline({ section: "file-backed" });

  assert.equal(baseline.counts.contextDocuments, 4);
  assert.equal(baseline.counts.wikiDocuments, 2);
  assert.equal(baseline.counts.tasks, 6);
  assert.equal(baseline.counts.checkpoints, 12);
  assert.equal(baseline.counts.publicJobs, 4);
  assert.equal(typeof baseline.elapsedMs, "number");
  assert.ok(baseline.context.textBytes > 0);
  assert.ok(baseline.wiki.textBytes > 0);
});

test("repo scanner baseline respects maxFiles and maxItems caps", async () => {
  const baseline = await runStabilityPerformanceBaseline({ section: "scanners" });

  assert.ok(baseline.repoMap.scannedFiles <= baseline.caps.maxFiles);
  assert.ok(baseline.businessLogicMap.scannedFiles <= baseline.caps.maxFiles);
  assert.ok(baseline.businessLogicMap.maxComparisonsPerFile <= baseline.caps.maxItemsPerFile);
  assert.ok(baseline.extensionScan.contracts <= baseline.caps.maxEndpoints);
  assert.ok(baseline.repoMap.layers.includes("ui"));
  assert.ok(baseline.repoMap.layers.includes("api"));
  assert.ok(baseline.repoMap.layers.includes("database"));
  assert.ok(baseline.extensionScan.verifiedContracts >= 1);
  assert.equal(typeof baseline.elapsedMs, "number");
});

test("baseline CLI writes scanner JSON artifact", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-baseline-cli-"));
  const out = path.join(root, "scanner-performance-baseline.json");

  await execFileAsync(process.execPath, ["scripts/stability-performance-baseline.mjs", "--section", "scanners", "--out", out]);
  const baseline = JSON.parse(await readFile(out, "utf8"));

  assert.equal(baseline.section, "scanners");
  assert.ok(baseline.repoMap);
  assert.ok(baseline.businessLogicMap);
  assert.ok(baseline.extensionScan);
  assert.equal(typeof baseline.elapsedMs, "number");
});
