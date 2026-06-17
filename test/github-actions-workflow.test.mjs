import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const workflowPath = path.join(repoRoot, ".github", "workflows", "ci.yml");

function readWorkflowText() {
  assert.ok(
    existsSync(workflowPath),
    "expected GitHub Actions workflow at .github/workflows/ci.yml",
  );
  return readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
}

function topLevelBlock(text, key) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line === `${key}:`);
  assert.notEqual(start, -1, `expected top-level ${key}: block`);

  const block = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) {
      break;
    }
    block.push(line);
  }
  return block.join("\n");
}

function assertMatches(text, pattern, message) {
  assert.match(text, pattern, message);
}

function assertOrdered(text, checks) {
  let cursor = 0;
  for (const [label, pattern] of checks) {
    const match = pattern.exec(text.slice(cursor));
    assert.ok(match, `expected ${label} after previous workflow command`);
    cursor += match.index + match[0].length;
  }
}

test("CI workflow preserves the approved PR gate contract", () => {
  const workflow = readWorkflowText();
  const onBlock = topLevelBlock(workflow, "on");
  const permissionsBlock = topLevelBlock(workflow, "permissions");
  const concurrencyBlock = topLevelBlock(workflow, "concurrency");
  const jobsBlock = topLevelBlock(workflow, "jobs");
  const jobIds = [...jobsBlock.matchAll(/^  ([A-Za-z0-9_-]+):\s*$/gm)].map((match) => match[1]);

  assertMatches(workflow, /^name:\s*CI\s*$/m, "workflow name must be CI");

  assertMatches(onBlock, /^  pull_request:\s*$/m, "workflow must run on pull_request");
  assertMatches(onBlock, /^  workflow_dispatch:\s*$/m, "workflow must allow workflow_dispatch");
  assertMatches(onBlock, /^  push:\s*$/m, "workflow must run on push");
  assertMatches(onBlock, /^    branches:\s*(?:\[main\]|$)/m, "push trigger must target main");
  if (/^    branches:\s*$/m.test(onBlock)) {
    assertMatches(onBlock, /^      -\s*main\s*$/m, "push trigger must list main");
  }

  assertMatches(permissionsBlock, /^  contents:\s*read\s*$/m, "workflow token must be read-only");
  assert.doesNotMatch(permissionsBlock, /^\s+[A-Za-z-]+:\s*write\s*$/m, "workflow token must not request write permissions");

  assertMatches(
    concurrencyBlock,
    /^  cancel-in-progress:\s*true\s*$/m,
    "workflow must cancel in-progress runs for the same ref",
  );

  assert.deepEqual(jobIds, ["verify"], "workflow must define only the verify job");
  assertMatches(jobsBlock, /^  verify:\s*$/m, "workflow must define verify job id");
  assertMatches(jobsBlock, /^    name:\s*verify\s*$/m, "verify job display name must be verify");
  assertMatches(jobsBlock, /^    runs-on:\s*ubuntu-latest\s*$/m, "verify job must use ubuntu-latest");

  assertMatches(jobsBlock, /uses:\s*actions\/checkout@v6\b/, "verify job must use actions/checkout@v6");
  assertMatches(jobsBlock, /uses:\s*actions\/setup-node@v6\b/, "verify job must use actions/setup-node@v6");
  assertMatches(jobsBlock, /node-version:\s*["']?20\.18\.0["']?\s*$/m, "setup-node must use Node 20.18.0");
  assertMatches(jobsBlock, /cache:\s*npm\s*$/m, "setup-node must enable the npm cache");
  assertMatches(
    jobsBlock,
    /cache-dependency-path:\s*package-lock\.json\s*$/m,
    "setup-node cache must key from package-lock.json",
  );

  assertMatches(jobsBlock, /^\s*run:\s*npm ci\s*$/m, "verify job must install dependencies with npm ci");
  assertMatches(
    jobsBlock,
    /tiny-chu-offline-v\*\.tar\.gz/,
    "verify job must resolve the generated offline bundle archive",
  );
  assertMatches(jobsBlock, /\bBUNDLE_PATH\b/, "verify job must export BUNDLE_PATH for verification");
  assertMatches(jobsBlock, /\bGITHUB_ENV\b/, "verify job must persist BUNDLE_PATH through GITHUB_ENV");
  assertMatches(
    jobsBlock,
    /\$\{#\w+\[@\]\}\s*(?:-ne|!=)\s*1/,
    "bundle resolution must fail unless exactly one archive is present",
  );

  assertOrdered(jobsBlock, [
    ["npm run build", /^\s*run:\s*npm run build\s*$/m],
    ["npm test", /^\s*run:\s*npm test\s*$/m],
    ["npm run pack:check", /^\s*run:\s*npm run pack:check\s*$/m],
    [
      "npm run release:offline",
      /^\s*run:\s*npm run release:offline -- --out "\$RUNNER_TEMP\/tiny-chu-release"\s*$/m,
    ],
    ["bundle resolution", /tiny-chu-offline-v\*\.tar\.gz[\s\S]*?\bGITHUB_ENV\b/],
    [
      "npm run verify:offline",
      /^\s*run:\s*npm run verify:offline -- --bundle "\$BUNDLE_PATH"\s*$/m,
    ],
  ]);

  const forbiddenWorkflowTerms = [
    /\bnpm\s+publish\b/i,
    /\bgh\s+release\b/i,
    /\bactions\/upload-artifact\b/i,
    /\battest(?:ation|ations)?\b/i,
    /\bsbom\b/i,
    /\bprovenance\b/i,
    /\bdeploy(?:ment)?\b/i,
    /\bbranch[- ]protection\b/i,
    /\brepos\/\S+\/branches\b/i,
    /\bGITHUB_TOKEN\b[\s\S]{0,120}\bwrite\b/i,
  ];

  for (const pattern of forbiddenWorkflowTerms) {
    assert.doesNotMatch(workflow, pattern, `workflow must not include ${pattern}`);
  }
});
