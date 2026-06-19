#!/usr/bin/env node
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const usage = "usage: node scripts/evaluate-small-model-contribution.mjs --fixture <path> --out <path> [--allow-fail]";

function parseArgs(argv) {
  const args = { fixture: undefined, out: undefined, allowFail: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--allow-fail") {
      args.allowFail = true;
      continue;
    }
    if (arg === "--fixture" || arg === "--out") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      args[arg.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.fixture || !args.out) {
    throw new Error("missing required --fixture or --out");
  }
  return args;
}

function resolveOutputPath(repoRoot, out) {
  const outPath = path.resolve(repoRoot, out);
  const relative = path.relative(repoRoot, outPath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("--out must resolve inside the repository root");
  }
  return outPath;
}

function isInsideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function assertOutputPathSafe(repoRoot, outPath) {
  const realRoot = await realpath(repoRoot);
  const parent = path.dirname(outPath);
  const realAncestor = await realExistingAncestor(parent);
  if (!isInsideRoot(realRoot, realAncestor)) {
    throw new Error("--out parent resolves outside the repository root");
  }
  await mkdir(parent, { recursive: true });
  const realParent = await realpath(parent);
  if (!isInsideRoot(realRoot, realParent)) {
    throw new Error("--out parent resolves outside the repository root");
  }
  try {
    const stat = await lstat(outPath);
    if (stat.isSymbolicLink()) {
      throw new Error("--out must not be a symbolic link");
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
}

async function realExistingAncestor(target) {
  let current = target;
  while (true) {
    try {
      return await realpath(current);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

try {
  const repoRoot = process.cwd();
  const args = parseArgs(process.argv.slice(2));
  const fixturePath = path.resolve(repoRoot, args.fixture);
  const outPath = resolveOutputPath(repoRoot, args.out);
  const moduleUrl = pathToFileURL(path.resolve(repoRoot, "dist/index.js"));
  const { createSmallModelContributionEvaluation } = await import(moduleUrl.href);

  if (typeof createSmallModelContributionEvaluation !== "function") {
    throw new Error("dist/index.js does not export createSmallModelContributionEvaluation");
  }

  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const result = createSmallModelContributionEvaluation(fixture);

  await assertOutputPathSafe(repoRoot, outPath);
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log(`status=${result.status} normalizedScore=${result.normalizedScore} band=${result.scoreBand} blockedReasons=${result.blockedReasons.length}`);
  if (result.status === "fail" && !args.allowFail) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(usage);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
