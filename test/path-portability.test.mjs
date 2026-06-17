import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { portableRelative, toPortablePath } from "../dist/state/path-safety.js";

test("toPortablePath normalizes Windows-style refs when refs contain backslashes", () => {
  // Given: refs shaped like Windows relative paths that are exposed in public output.
  const refs = [
    ["src\\AGENTS.md", "src/AGENTS.md"],
    ["src\\ui\\CheckoutButton.tsx", "src/ui/CheckoutButton.tsx"],
    [".tiny\\plans\\PLAN.md", ".tiny/plans/PLAN.md"],
    ["src\\mixed/path\\File.ts", "src/mixed/path/File.ts"],
    ["src\\trailing\\", "src/trailing/"],
  ];

  // When/Then: each ref is normalized to a slash-separated portable ref.
  for (const [input, expected] of refs) {
    assert.equal(toPortablePath(input), expected);
  }
});

test("portableRelative returns a portable slash-separated relative ref", async () => {
  // Given: a native filesystem path pair under a temporary root.
  const root = await mkdtemp(path.join(tmpdir(), "tiny-chu-paths-"));
  const nestedDir = path.join(root, "src", "ui");
  const file = path.join(nestedDir, "CheckoutButton.tsx");
  await mkdir(nestedDir, { recursive: true });
  await writeFile(file, "export const name = 'CheckoutButton';\n");

  try {
    // When: the helper computes a relative ref from native paths.
    const relative = portableRelative(root, file);

    // Then: the public ref is stable across path separator conventions.
    assert.equal(relative, "src/ui/CheckoutButton.tsx");
    assert.equal(relative.includes("\\"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
