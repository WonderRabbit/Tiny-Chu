import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { acquireSafeToolingLock, createArtifactPublishApply, createArtifactPublishManifest, createArtifactWorkspaceCommit, createArtifactWorkspacePrepare, hashSourceTarget } from "../dist/index.js";

const execFileAsync = promisify(execFile);

async function makeDirectoryUnwritable(directory) {
  if (process.platform !== "win32") {
    await chmod(directory, 0o500);
    return () => chmod(directory, 0o700);
  }
  const identity = process.env.USERDOMAIN && process.env.USERNAME ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : process.env.USERNAME;
  assert.ok(identity, "Windows ACL tests need USERNAME");
  await execFileAsync("icacls", [directory, "/deny", `${identity}:(OI)(CI)(W,D)`]);
  return () => execFileAsync("icacls", [directory, "/remove:d", identity]);
}

test("artifact_workspace_prepare creates an isolated git workspace outside source root", async () => {
  // Given: a source repo with allowlisted input.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-artifact-source-"));
  await mkdir(path.join(root, ".git"));
  await mkdir(path.join(root, "docs"));
  await writeFile(path.join(root, "docs", "seed.md"), "# Seed\n", "utf8");

  // When: an artifact workspace is prepared.
  const workspace = await createArtifactWorkspacePrepare(root, {
    allowedInputs: ["docs/seed.md"],
    copyInputs: ["docs/seed.md"],
    initGit: true,
    purpose: "docs",
  });

  // Then: the workspace is outside source root and owns its own git directory.
  assert.equal(workspace.valid, true);
  const relativeToSource = path.relative(root, workspace.workspaceRoot);
  assert.ok(relativeToSource.startsWith("..") || path.isAbsolute(relativeToSource));
  assert.equal(await readFile(path.join(workspace.workspaceRoot, "docs", "seed.md"), "utf8"), "# Seed\n");
  assert.ok(await stat(path.join(workspace.workspaceRoot, ".git")));
  assert.notEqual(path.resolve(workspace.workspaceRoot, ".git"), path.resolve(root, ".git"));
});

test("artifact_workspace_prepare rejects empty allowlists and escaping inputs", async () => {
  // Given: an empty temp root.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-artifact-reject-"));

  // When: invalid workspace requests are made.
  const empty = await createArtifactWorkspacePrepare(root, { allowedInputs: [], copyInputs: [], initGit: false });
  const escape = await createArtifactWorkspacePrepare(root, { allowedInputs: ["../escape.md"], copyInputs: ["../escape.md"], initGit: false });

  // Then: both are rejected without throwing.
  assert.equal(empty.valid, false);
  assert.equal(escape.valid, false);
});

test("artifact_workspace_commit commits inside workspace with deterministic identity", async () => {
  // Given: an isolated artifact workspace with git initialized.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-artifact-commit-source-"));
  await mkdir(path.join(root, "docs"));
  await writeFile(path.join(root, "docs", "seed.md"), "# Seed\n", "utf8");
  const workspace = await createArtifactWorkspacePrepare(root, {
    allowedInputs: ["docs/seed.md"],
    copyInputs: ["docs/seed.md"],
    initGit: true,
    purpose: "commit-test",
  });
  await writeFile(path.join(workspace.workspaceRoot, "docs", "generated.md"), "# Generated\n", "utf8");

  // When: the workspace is committed.
  const commit = await createArtifactWorkspaceCommit(root, { workspaceRoot: workspace.workspaceRoot, message: "artifact docs" });

  // Then: the commit succeeds inside the workspace only.
  assert.equal(commit.valid, true);
  assert.match(commit.commit, /^[0-9a-f]{40}$/);
});

test("artifact publish manifest and apply are allowlisted hash-checked operations", async () => {
  // Given: generated workspace output and an existing target.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-artifact-publish-"));
  await mkdir(path.join(root, "docs"));
  await writeFile(path.join(root, "docs", "report.md"), "# Old\n", "utf8");
  const before = await hashSourceTarget(root, "docs/report.md");
  const workspace = await createArtifactWorkspacePrepare(root, {
    allowedInputs: ["docs/report.md"],
    copyInputs: ["docs/report.md"],
    initGit: false,
    purpose: "publish",
  });
  await writeFile(path.join(workspace.workspaceRoot, "report.md"), "# New\n", "utf8");

  // When: a manifest is created, dry-run, stale apply, and valid apply are executed.
  const manifest = await createArtifactPublishManifest(root, {
    workspaceRoot: workspace.workspaceRoot,
    entries: [{ source: "report.md", target: "docs/report.md" }],
    allowedTargets: ["docs/**"],
  });
  const dryRun = await createArtifactPublishApply(root, { manifestPath: manifest.manifestPath, dryRun: true });
  await writeFile(path.join(root, "docs", "report.md"), "# Stale\n", "utf8");
  const stale = await createArtifactPublishApply(root, { manifestPath: manifest.manifestPath });
  assert.equal(stale.applied, false);
  assert.equal(await readFile(path.join(root, "docs", "report.md"), "utf8"), "# Stale\n");

  await writeFile(path.join(root, "docs", "report.md"), "# Old\n", "utf8");
  const applied = await createArtifactPublishApply(root, { manifestPath: manifest.manifestPath });

  // Then: dry-run writes nothing, stale apply refuses, and valid apply publishes.
  assert.equal(manifest.valid, true);
  assert.equal(manifest.entries[0].targetBefore.hash, before.hash);
  assert.equal(dryRun.applied, false);
  assert.equal(applied.applied, true);
  assert.equal(await readFile(path.join(root, "docs", "report.md"), "utf8"), "# New\n");
});

test("artifact publish and commit reject forged unprepared workspace inputs", async () => {
  // Given: a caller-supplied workspace and manifest outside Tiny-Chu artifact state.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-artifact-forged-root-"));
  const workspace = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-artifact-forged-workspace-"));
  const manifestPath = path.join(workspace, "manifest.json");
  await mkdir(path.join(root, "docs"));
  await writeFile(path.join(root, "docs", "report.md"), "# Old\n", "utf8");
  await writeFile(path.join(workspace, "report.md"), "# New\n", "utf8");
  await writeFile(manifestPath, JSON.stringify({
    manifestVersion: 1,
    manifestId: "forged",
    workspaceRoot: workspace,
    entries: [],
  }), "utf8");

  // When: commit and publish are requested with untrusted paths.
  const commit = await createArtifactWorkspaceCommit(root, { workspaceRoot: workspace, message: "forged" });
  const applied = await createArtifactPublishApply(root, { manifestPath });

  // Then: both refuse instead of operating on arbitrary caller paths.
  assert.equal(commit.valid, false);
  assert.equal(applied.applied, false);
});

test("artifact_publish_apply rolls back when a multi-file publish write fails", async () => {
  // Given: a valid two-file publish manifest.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-artifact-rollback-"));
  await mkdir(path.join(root, "docs"));
  await mkdir(path.join(root, "locked"));
  await writeFile(path.join(root, "docs", "one.md"), "one-old\n", "utf8");
  await writeFile(path.join(root, "locked", "two.md"), "two-old\n", "utf8");
  const workspace = await createArtifactWorkspacePrepare(root, {
    allowedInputs: ["docs/**", "locked/**"],
    copyInputs: ["docs/one.md", "locked/two.md"],
    initGit: false,
  });
  await writeFile(path.join(workspace.workspaceRoot, "one.md"), "one-new\n", "utf8");
  await writeFile(path.join(workspace.workspaceRoot, "two.md"), "two-new\n", "utf8");
  const manifest = await createArtifactPublishManifest(root, {
    workspaceRoot: workspace.workspaceRoot,
    entries: [
      { source: "one.md", target: "docs/one.md" },
      { source: "two.md", target: "locked/two.md" },
    ],
    allowedTargets: ["docs/**", "locked/**"],
  });

  // When: the second target becomes unwritable after manifest creation.
  const restoreWritable = await makeDirectoryUnwritable(path.join(root, "locked"));
  let failed;
  try {
    failed = await createArtifactPublishApply(root, { manifestPath: manifest.manifestPath });
  } finally {
    await restoreWritable();
  }

  // Then: the first write is rolled back and no partial publish remains.
  assert.equal(failed.applied, false);
  assert.ok(failed.diagnostics.some((diagnostic) => diagnostic.code === (process.platform === "win32" ? "target_access_failed" : "publish_write_failed")));
  assert.equal(await readFile(path.join(root, "docs", "one.md"), "utf8"), "one-old\n");
  assert.equal(await readFile(path.join(root, "locked", "two.md"), "utf8"), "two-old\n");
});

test("artifact publish manifest rejects workspace symlink sources", async () => {
  // Given: a prepared workspace with a generated source symlinked outside it.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-artifact-source-link-root-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-artifact-source-link-outside-"));
  await mkdir(path.join(root, "docs"));
  await writeFile(path.join(root, "docs", "report.md"), "# Old\n", "utf8");
  await writeFile(path.join(outside, "secret.md"), "secret\n", "utf8");
  const workspace = await createArtifactWorkspacePrepare(root, {
    allowedInputs: ["docs/report.md"],
    copyInputs: ["docs/report.md"],
    initGit: false,
  });
  await symlink(path.join(outside, "secret.md"), path.join(workspace.workspaceRoot, "generated.md"));

  // When: a publish manifest is requested for that symlink.
  const manifest = await createArtifactPublishManifest(root, {
    workspaceRoot: workspace.workspaceRoot,
    entries: [{ source: "generated.md", target: "docs/report.md" }],
    allowedTargets: ["docs/**"],
  });

  // Then: the symlink is treated as an unpublishable workspace source.
  assert.equal(manifest.valid, false);
  assert.ok(manifest.diagnostics.some((diagnostic) => diagnostic.code === "missing_workspace_source"));
  assert.equal(await readFile(path.join(root, "docs", "report.md"), "utf8"), "# Old\n");
});

test("artifact_publish_apply rejects malformed manifests under .tiny artifacts", async () => {
  // Given: malformed and wrong-shaped manifests under the trusted artifact directory.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-artifact-bad-manifest-"));
  await mkdir(path.join(root, ".tiny", "artifacts"), { recursive: true });
  const malformedPath = path.join(root, ".tiny", "artifacts", "bad.json");
  const wrongShapePath = path.join(root, ".tiny", "artifacts", "wrong.json");
  await writeFile(malformedPath, "{bad", "utf8");
  await writeFile(wrongShapePath, JSON.stringify({ manifestVersion: 1, workspaceRoot: root, entries: "not-array" }), "utf8");

  // When: publish apply reads those manifests.
  const malformed = await createArtifactPublishApply(root, { manifestPath: malformedPath });
  const wrongShape = await createArtifactPublishApply(root, { manifestPath: wrongShapePath });

  // Then: both fail closed with diagnostics instead of throwing.
  assert.equal(malformed.applied, false);
  assert.equal(wrongShape.applied, false);
  assert.ok(malformed.diagnostics.some((diagnostic) => diagnostic.code === "untrusted_manifest"));
  assert.ok(wrongShape.diagnostics.some((diagnostic) => diagnostic.code === "untrusted_manifest"));
});

test("artifact_publish_apply refuses when the safe tooling lock is already held", async () => {
  // Given: a valid manifest and a pre-held root lock.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-artifact-locked-"));
  await mkdir(path.join(root, "docs"));
  await writeFile(path.join(root, "docs", "report.md"), "# Old\n", "utf8");
  const workspace = await createArtifactWorkspacePrepare(root, { allowedInputs: ["docs/report.md"], copyInputs: ["docs/report.md"], initGit: false });
  await writeFile(path.join(workspace.workspaceRoot, "report.md"), "# New\n", "utf8");
  const manifest = await createArtifactPublishManifest(root, {
    workspaceRoot: workspace.workspaceRoot,
    entries: [{ source: "report.md", target: "docs/report.md" }],
    allowedTargets: ["docs/**"],
  });
  const lock = await acquireSafeToolingLock(root);
  assert.ok(lock);

  // When: publish is attempted while the lock is held.
  const result = await createArtifactPublishApply(root, { manifestPath: manifest.manifestPath });
  await lock.release();

  // Then: publish refuses and target remains unchanged.
  assert.equal(result.applied, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "locked"));
  assert.equal(await readFile(path.join(root, "docs", "report.md"), "utf8"), "# Old\n");
});
