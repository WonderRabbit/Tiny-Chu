import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SYMLINK_TEST_SKIP_PATTERN = "[sS]ymlink";

export function discoverTestFiles(explicitTestFiles = process.argv.slice(2)) {
  return explicitTestFiles.length > 0
    ? explicitTestFiles
    : readdirSync("test")
        .filter((file) => file.endsWith(".test.mjs"))
        .sort()
        .map((file) => path.join("test", file));
}

export function canCreateFileSymlink() {
  const root = mkdtempSync(path.join(os.tmpdir(), "tiny-chu-file-symlink-check-"));
  try {
    const target = path.join(root, "target.txt");
    const link = path.join(root, "link.txt");
    writeFileSync(target, "target\n", "utf8");
    symlinkSync(target, link, "file");
    return true;
  } catch {
    return false;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function shouldSkipSymlinkTests({
  platform = process.platform,
  env = process.env,
  canCreateFileSymlinkFn = canCreateFileSymlink,
} = {}) {
  if (env.TINY_CHU_TEST_ASSUME_NO_SYMLINKS === "1") return true;
  if (env.TINY_CHU_TEST_ASSUME_NO_SYMLINKS === "0") return false;
  return platform === "win32" && !canCreateFileSymlinkFn();
}

export function buildNodeTestArgs(testFiles, options = {}) {
  const args = ["--test"];
  if (shouldSkipSymlinkTests(options)) args.push("--test-skip-pattern", SYMLINK_TEST_SKIP_PATTERN);
  return [...args, ...testFiles];
}

function isDirectRun() {
  const scriptPath = process.argv[1];
  return scriptPath !== undefined && path.resolve(scriptPath) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  const testFiles = discoverTestFiles();
  if (testFiles.length === 0) {
    throw new Error("No Node test files found under test/*.test.mjs");
  }

  const args = buildNodeTestArgs(testFiles);
  if (args.includes("--test-skip-pattern")) {
    console.warn("Tiny-Chu test runner: Windows file symlink creation is unavailable; skipping symlink-specific tests.");
  }

  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  process.exit(result.status ?? 1);
}
