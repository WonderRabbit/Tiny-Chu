import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireSafeToolingLock, createSafePatchApply, createSafePatchCheck, hashSourceTarget, SAFE_TOOLING_LIMITS } from "../dist/index.js";

test("safe_patch_check accepts a hash-matched patch without mutating source", async () => {
  // Given: a source file and an allowlisted patch with the correct before hash.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-safe-check-"));
  await writeFile(path.join(root, "note.txt"), "old\n", "utf8");
  const before = await hashSourceTarget(root, "note.txt");
  const patch = [
    "diff --git a/note.txt b/note.txt",
    "--- a/note.txt",
    "+++ b/note.txt",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");

  // When: the patch is checked.
  const result = await createSafePatchCheck(root, { patch, allowedTargets: ["note.txt"], expectedFiles: { "note.txt": before.hash } });

  // Then: validation succeeds and the source bytes are unchanged.
  assert.equal(result.valid, true);
  assert.equal(result.wouldMutate, false);
  assert.deepEqual(result.touchedFiles.map((item) => item.path), ["note.txt"]);
  assert.equal(await readFile(path.join(root, "note.txt"), "utf8"), "old\n");
});

test("safe_patch_check rejects unsafe paths stale hashes symlinks and oversized input", async () => {
  // Given: a root with one file and one symlink target.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-safe-reject-"));
  await writeFile(path.join(root, "note.txt"), "old\n", "utf8");
  await writeFile(path.join(root, "real.txt"), "real\n", "utf8");
  await symlink(path.join(root, "real.txt"), path.join(root, "link.txt"));
  const validPatch = [
    "diff --git a/note.txt b/note.txt",
    "--- a/note.txt",
    "+++ b/note.txt",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");
  const escapePatch = validPatch.replaceAll("note.txt", "../escape.txt");
  const symlinkPatch = validPatch.replaceAll("note.txt", "link.txt").replace("old", "real");
  const largePatch = `${"x".repeat(SAFE_TOOLING_LIMITS.maxPatchBytes + 1)}`;

  // When: unsafe variants are checked.
  const stale = await createSafePatchCheck(root, { patch: validPatch, allowedTargets: ["note.txt"], expectedFiles: { "note.txt": "sha256:00" } });
  const escape = await createSafePatchCheck(root, { patch: escapePatch, allowedTargets: ["../escape.txt"], expectedFiles: { "../escape.txt": "missing" } });
  const link = await createSafePatchCheck(root, { patch: symlinkPatch, allowedTargets: ["link.txt"], expectedFiles: { "link.txt": "sha256:00" } });
  const large = await createSafePatchCheck(root, { patch: largePatch, allowedTargets: ["note.txt"], expectedFiles: {} });

  // Then: every unsafe variant is rejected without changing the file.
  assert.equal(stale.valid, false);
  assert.equal(escape.valid, false);
  assert.equal(link.valid, false);
  assert.equal(large.valid, false);
  assert.equal(await readFile(path.join(root, "note.txt"), "utf8"), "old\n");
});

test("safe_patch_apply writes approved bytes and refuses stale multi-file patches atomically", async () => {
  // Given: two source files and a multi-file patch.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-safe-apply-"));
  await writeFile(path.join(root, "one.txt"), "one\n", "utf8");
  await writeFile(path.join(root, "two.txt"), "two\n", "utf8");
  const oneBefore = await hashSourceTarget(root, "one.txt");
  const twoBefore = await hashSourceTarget(root, "two.txt");
  const patch = [
    "diff --git a/one.txt b/one.txt",
    "--- a/one.txt",
    "+++ b/one.txt",
    "@@ -1 +1 @@",
    "-one",
    "+ONE",
    "diff --git a/two.txt b/two.txt",
    "--- a/two.txt",
    "+++ b/two.txt",
    "@@ -1 +1 @@",
    "-two",
    "+TWO",
    "",
  ].join("\n");

  // When: one expected hash is stale, then the correct hashes are used.
  const stale = await createSafePatchApply(root, {
    patch,
    allowedTargets: ["*.txt"],
    expectedFiles: { "one.txt": oneBefore.hash, "two.txt": "sha256:00" },
  });
  assert.equal(stale.applied, false);
  assert.equal(await readFile(path.join(root, "one.txt"), "utf8"), "one\n");
  assert.equal(await readFile(path.join(root, "two.txt"), "utf8"), "two\n");

  const applied = await createSafePatchApply(root, {
    patch,
    allowedTargets: ["*.txt"],
    expectedFiles: { "one.txt": oneBefore.hash, "two.txt": twoBefore.hash },
  });

  // Then: the stale attempt writes nothing and the valid attempt updates both files.
  assert.equal(await readFile(path.join(root, "one.txt"), "utf8"), "ONE\n");
  assert.equal(await readFile(path.join(root, "two.txt"), "utf8"), "TWO\n");
  assert.equal(applied.applied, true);
});

test("safe_patch_check accepts new files only when parent stays inside root", async () => {
  // Given: an allowlisted new file path under an existing directory.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-safe-new-"));
  await mkdir(path.join(root, "docs"));
  const patch = [
    "diff --git a/docs/new.txt b/docs/new.txt",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/docs/new.txt",
    "@@ -0,0 +1 @@",
    "+created",
    "",
  ].join("\n");

  // When: the patch is checked with missing expected status.
  const result = await createSafePatchCheck(root, { patch, allowedTargets: ["docs/**"], expectedFiles: { "docs/new.txt": "missing" } });

  // Then: validation succeeds without writing the new file.
  assert.equal(result.valid, true);
  await assert.rejects(() => readFile(path.join(root, "docs", "new.txt"), "utf8"), { code: "ENOENT" });
});

test("safe_patch_apply refuses targets under symlinked parent directories", async () => {
  // Given: a root-relative parent directory is a symlink to an outside directory.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-safe-parent-link-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-safe-parent-outside-"));
  await writeFile(path.join(outside, "owned.txt"), "outside\n", "utf8");
  await symlink(outside, path.join(root, "linked"));
  const patch = [
    "diff --git a/linked/owned.txt b/linked/owned.txt",
    "--- a/linked/owned.txt",
    "+++ b/linked/owned.txt",
    "@@ -1 +1 @@",
    "-outside",
    "+mutated",
    "",
  ].join("\n");

  // When: the patch is checked and applied.
  const checked = await createSafePatchCheck(root, { patch, allowedTargets: ["linked/**"], expectedFiles: { "linked/owned.txt": "sha256:00" } });
  const applied = await createSafePatchApply(root, { patch, allowedTargets: ["linked/**"], expectedFiles: { "linked/owned.txt": "sha256:00" } });

  // Then: both reject and the outside file is unchanged.
  assert.equal(checked.valid, false);
  assert.equal(applied.applied, false);
  assert.equal(await readFile(path.join(outside, "owned.txt"), "utf8"), "outside\n");
});

test("safe_patch_apply rolls back after a multi-file write failure", async () => {
  // Given: a valid multi-file patch.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-safe-rollback-"));
  await mkdir(path.join(root, "a"));
  await mkdir(path.join(root, "z"));
  await writeFile(path.join(root, "a", "one.txt"), "one\n", "utf8");
  await writeFile(path.join(root, "z", "two.txt"), "two\n", "utf8");
  const oneBefore = await hashSourceTarget(root, "a/one.txt");
  const twoBefore = await hashSourceTarget(root, "z/two.txt");
  const patch = [
    "diff --git a/a/one.txt b/a/one.txt",
    "--- a/a/one.txt",
    "+++ b/a/one.txt",
    "@@ -1 +1 @@",
    "-one",
    "+ONE",
    "diff --git a/z/two.txt b/z/two.txt",
    "--- a/z/two.txt",
    "+++ b/z/two.txt",
    "@@ -1 +1 @@",
    "-two",
    "+TWO",
    "",
  ].join("\n");

  // When: the second target directory becomes unwritable after validation data is captured.
  await chmod(path.join(root, "z"), 0o500);
  const result = await createSafePatchApply(root, {
    patch,
    allowedTargets: ["a/**", "z/**"],
    expectedFiles: { "a/one.txt": oneBefore.hash, "z/two.txt": twoBefore.hash },
  });
  await chmod(path.join(root, "z"), 0o700);

  // Then: no partial write remains.
  assert.equal(result.applied, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "apply_write_failed"));
  assert.equal(await readFile(path.join(root, "a", "one.txt"), "utf8"), "one\n");
  assert.equal(await readFile(path.join(root, "z", "two.txt"), "utf8"), "two\n");
});

test("safe_patch_apply refuses when the safe tooling lock is already held", async () => {
  // Given: a valid patch and a pre-held root lock.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-safe-locked-"));
  await writeFile(path.join(root, "note.txt"), "old\n", "utf8");
  const before = await hashSourceTarget(root, "note.txt");
  const lock = await acquireSafeToolingLock(root);
  assert.ok(lock);
  const patch = [
    "diff --git a/note.txt b/note.txt",
    "--- a/note.txt",
    "+++ b/note.txt",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");

  // When: apply is attempted while the lock is held.
  const result = await createSafePatchApply(root, { patch, allowedTargets: ["note.txt"], expectedFiles: { "note.txt": before.hash } });
  await lock.release();

  // Then: the apply refuses and source remains unchanged.
  assert.equal(result.applied, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "locked"));
  assert.equal(await readFile(path.join(root, "note.txt"), "utf8"), "old\n");
});
