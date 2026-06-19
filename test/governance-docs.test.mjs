import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function readText(file) {
  assert.equal(existsSync(file), true, `${file} should exist`);
  return readFileSync(file, "utf8");
}

function assertIncludes(file, terms) {
  const text = readText(file);
  for (const term of terms) assert.ok(text.includes(term), `${file} missing ${term}`);
  return text;
}

test("root governance docs expose contributor conduct security and release contracts", () => {
  const contributing = assertIncludes("CONTRIBUTING.md", [
    "npm run build",
    "npm test",
    "CHANGELOG.md",
    "CODE_OF_CONDUCT.md",
    "SECURITY.md",
    "release",
    "vX.Y.Z",
    "package.json.version",
    "git tag --list v0.1.0",
    "git tag -a vX.Y.Z",
    "separate user authorization",
    "backup maintainer",
    "credential recovery",
  ]);
  assert.match(contributing, /do not run `git tag`, `git push`, or `npm publish` without separate user authorization/i);

  assertIncludes("CODE_OF_CONDUCT.md", ["Contributor Covenant", "TODO: maintainer contact"]);
  assertIncludes("SECURITY.md", [
    "0.1.x",
    "0.1.0",
    "TODO: maintainer contact",
    "7 days",
    "30 days",
    "private vulnerability reporting",
  ]);
});

test("github templates are present", () => {
  for (const file of [
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature_request.yml",
  ]) {
    const text = readText(file);
    for (const key of ["name:", "description:", "title:", "labels:", "body:"]) {
      assert.ok(text.includes(key), `${file} missing ${key}`);
    }
    assert.equal(/\t/.test(text), false, `${file} should not contain tabs`);
  }

  assertIncludes(".github/pull_request_template.md", [
    "Summary",
    "Linked issue",
    "Tests",
    "CHANGELOG.md",
    "Release impact",
    "Breaking change",
    "Security impact",
  ]);
});

test("canonical changelog replaces legacy HYSTORY path", () => {
  const changelog = assertIncludes("CHANGELOG.md", [
    "# Changelog",
    "## [Unreleased]",
    "## [0.1.0] - 2026-06-16",
    "Added",
    "Changed",
    "Fixed",
    "Security",
  ]);
  assert.equal(/구현 완료|available now/i.test(changelog), false);

  const history = readText("docs/HYSTORY.md");
  assert.match(history, /CHANGELOG\.md/);
  assert.match(history, /HISTORY\.md/);
  assert.match(history, /legacy/i);

  assertIncludes("docs/HISTORY.md", ["CHANGELOG.md", "HYSTORY.md", "0.1.0", "Unreleased"]);
});

test("root usage docs cross-link governance and release surfaces", () => {
  for (const file of ["README.md", "INSTALL.md", "HOW_TO_USE.md"]) {
    assertIncludes(file, ["CONTRIBUTING.md", "SECURITY.md", "CHANGELOG.md"]);
  }
  assertIncludes("README.md", ["docs/HISTORY.md"]);
  assertIncludes("HOW_TO_USE.md", ["docs/HISTORY.md"]);
  assertIncludes("README.md", ["CODE_OF_CONDUCT.md", ".github/ISSUE_TEMPLATE/", ".github/pull_request_template.md"]);
});
