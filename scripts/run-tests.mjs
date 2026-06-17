import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const explicitTestFiles = process.argv.slice(2);
const testFiles =
  explicitTestFiles.length > 0
    ? explicitTestFiles
    : readdirSync("test")
        .filter((file) => file.endsWith(".test.mjs"))
        .sort()
        .map((file) => `test/${file}`);

if (testFiles.length === 0) {
  throw new Error("No Node test files found under test/*.test.mjs");
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
