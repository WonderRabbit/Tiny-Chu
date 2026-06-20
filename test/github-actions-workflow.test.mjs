import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

function ignoredPath(path) {
  return execFileSync("git", ["check-ignore", path], { encoding: "utf8" }).trim();
}

test("GitHub metadata paths are ignored instead of tracked", () => {
  const gitignore = readFileSync(".gitignore", "utf8");

  assert.match(gitignore, /^\.github\/$/m);
  assert.match(gitignore, /^\.idea\/$/m);
  assert.equal(ignoredPath(".github/workflows/ci.yml"), ".github/workflows/ci.yml");
  assert.equal(ignoredPath(".idea/workspace.xml"), ".idea/workspace.xml");
});
