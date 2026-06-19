import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { WikiBundler } from "../dist/index.js";
import { createPortableSymlink as symlink } from "./support/symlink.mjs";

const distUrl = pathToFileURL(path.join(process.cwd(), "dist", "index.js")).href;
const readyLine = "__tiny_chu_child_ready__";

async function makeRoot(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, ".tiny", "wiki", "domains"), { recursive: true });
  return root;
}

function runNodeScript(script) {
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  let ready = false;
  let released = false;
  let resolveReady;
  let rejectReady;
  let resolveDone;
  let rejectDone;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const done = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const timeout = setTimeout(() => {
    child.kill("SIGKILL");
    const error = new Error("Timed out waiting for child process");
    rejectReady(error);
    rejectDone(error);
  }, 15_000);
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (!ready && stdout.split(/\r?\n/).includes(readyLine)) {
      ready = true;
      resolveReady();
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.once("error", (error) => {
    clearTimeout(timeout);
    rejectReady(error);
    rejectDone(error);
  });
  child.once("close", (code, signal) => {
    clearTimeout(timeout);
    if (!ready) rejectReady(new Error(`Child exited before ready: ${stderr || signal || code}`));
    if (code !== 0) {
      rejectDone(new Error(`Child exited with ${code ?? signal}: ${stderr}`));
      return;
    }
    const lines = stdout.trim().split(/\r?\n/).filter((line) => line && line !== readyLine);
    try {
      resolveDone(JSON.parse(lines.at(-1) ?? ""));
    } catch (error) {
      rejectDone(new Error(`Child did not emit JSON: ${error instanceof Error ? error.message : String(error)}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }
  });
  return {
    ready: readyPromise,
    release: () => {
      if (released) return;
      released = true;
      child.stdin.end("go\n");
    },
    done,
    kill: () => child.kill("SIGKILL"),
  };
}

async function collectReleasedChildren(children) {
  try {
    await Promise.all(children.map((child) => child.ready));
    for (const child of children) child.release();
    return await Promise.all(children.map((child) => child.done));
  } catch (error) {
    for (const child of children) child.kill();
    await Promise.allSettled(children.map((child) => child.done));
    throw error;
  }
}

function readySnippet() {
  return `
    const release = new Promise((resolve) => process.stdin.once("data", resolve));
    console.log(${JSON.stringify(readyLine)});
    await release;
  `;
}

test("WikiBundler selects canonical docs and tag matches when paths stay inside root", async () => {
  // Given
  const root = await makeRoot("tiny-chu-wiki-happy-");
  await writeFile(path.join(root, ".tiny", "wiki", "domains", "backend.md"), "Backend truth", "utf8");
  await writeFile(path.join(root, ".tiny", "wiki", "domains", "frontend.md"), "Frontend truth", "utf8");
  const wiki = new WikiBundler(root);
  await wiki.upsertDocument({ id: "backend", path: ".tiny/wiki/domains/backend.md", canonical: true, tags: ["backend", "api"], freshness: "manual" });
  await wiki.upsertDocument({ id: "frontend", path: ".tiny/wiki/domains/frontend.md", canonical: false, tags: ["frontend"], freshness: "manual" });

  // When
  const canonical = await wiki.bundle();
  const tagged = await wiki.bundle(["frontend"]);

  // Then
  assert.match(canonical.text, /Backend truth/);
  assert.doesNotMatch(canonical.text, /Frontend truth/);
  assert.match(tagged.text, /Frontend truth/);
});

test("WikiBundler upsertDocument preserves all cross-process documents", async () => {
  // Given: child processes share one wiki index and distinct document refs.
  const root = await makeRoot("tiny-chu-wiki-cross-process-upsert-");
  const workerCount = 10;
  await Promise.all(Array.from({ length: workerCount }, (_, index) => writeFile(
    path.join(root, ".tiny", "wiki", "domains", `doc-${index}.md`),
    `Document ${index}`,
    "utf8",
  )));

  // When: every child upserts a distinct ref after the same release signal.
  const children = Array.from({ length: workerCount }, (_, index) => runNodeScript(`
    const { WikiBundler } = await import(${JSON.stringify(distUrl)});
    ${readySnippet()}
    const wiki = new WikiBundler(${JSON.stringify(root)});
    const index = await wiki.upsertDocument({
      id: ${JSON.stringify(`doc-${index}`)},
      path: ${JSON.stringify(`.tiny/wiki/domains/doc-${index}.md`)},
      canonical: true,
      tags: ["cross-process", ${JSON.stringify(`doc-${index}`)}],
      freshness: "manual"
    });
    console.log(JSON.stringify({ ids: index.documents.map((doc) => doc.id) }));
  `));
  await collectReleasedChildren(children);
  const expectedIds = Array.from({ length: workerCount }, (_, index) => `doc-${index}`).sort();
  const index = JSON.parse(await readFile(path.join(root, ".tiny", "wiki", "index.json"), "utf8"));

  // Then: index.json contains every distinct ref, not only the final writer's view.
  assert.deepEqual(index.documents.map((doc) => doc.id).sort(), expectedIds);
  assert.deepEqual((await new WikiBundler(root).readIndex()).documents.map((doc) => doc.id).sort(), expectedIds);
});

test("WikiBundler allows inside-root symlinks whose real path stays inside root", async () => {
  // Given
  const root = await makeRoot("tiny-chu-wiki-symlink-inside-");
  const target = path.join(root, ".tiny", "wiki", "domains", "backend.md");
  await writeFile(target, "Backend truth through link", "utf8");
  await symlink(target, path.join(root, ".tiny", "wiki", "domains", "linked.md"));
  const wiki = new WikiBundler(root);
  await wiki.upsertDocument({ id: "linked", path: ".tiny/wiki/domains/linked.md", canonical: true, tags: ["backend"], freshness: "manual" });

  // When
  const bundle = await wiki.bundle(["backend"]);

  // Then
  assert.match(bundle.text, /Backend truth through link/);
});

test("WikiBundler rejects relative parent refs that escape the configured root", async () => {
  // Given
  const parent = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-wiki-relative-parent-"));
  const root = path.join(parent, "repo");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(parent, "outside.md"), "Outside truth", "utf8");
  const wiki = new WikiBundler(root);
  await wiki.upsertDocument({ id: "outside", path: "../outside.md", canonical: true, tags: ["escape"], freshness: "manual" });

  // When / Then
  await assert.rejects(() => wiki.bundle(), /outside configured root|outside root/);
});

test("WikiBundler rejects absolute document refs outside the configured root", async () => {
  // Given
  const root = await makeRoot("tiny-chu-wiki-absolute-root-");
  const outside = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-wiki-absolute-outside-"));
  const outsideFile = path.join(outside, "outside.md");
  await writeFile(outsideFile, "Outside truth", "utf8");
  const wiki = new WikiBundler(root);
  await wiki.upsertDocument({ id: "outside", path: outsideFile, canonical: true, tags: ["escape"], freshness: "manual" });

  // When / Then
  await assert.rejects(() => wiki.bundle(), /outside configured root|outside root/);
});

test("WikiBundler rejects inside-root symlinks whose real path escapes the configured root", async () => {
  // Given
  const root = await makeRoot("tiny-chu-wiki-symlink-root-");
  const outside = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-wiki-symlink-outside-"));
  const outsideFile = path.join(outside, "outside.md");
  await writeFile(outsideFile, "Outside truth", "utf8");
  await symlink(outsideFile, path.join(root, ".tiny", "wiki", "domains", "linked.md"));
  const wiki = new WikiBundler(root);
  await wiki.upsertDocument({ id: "linked", path: ".tiny/wiki/domains/linked.md", canonical: true, tags: ["escape"], freshness: "manual" });

  // When / Then
  await assert.rejects(() => wiki.bundle(), /outside configured root|outside root/);
});

test("WikiBundler rejects symlinked wiki index directories", async () => {
  // Given
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-wiki-index-dir-symlink-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-wiki-index-dir-outside-"));
  await mkdir(path.join(root, ".tiny"), { recursive: true });
  await writeFile(path.join(outside, "index.json"), `${JSON.stringify({ documents: [] })}\n`, "utf8");
  await symlink(outside, path.join(root, ".tiny", "wiki"));
  const wiki = new WikiBundler(root);

  // When / Then
  await assert.rejects(() => wiki.readIndex(), /symlink|escapes root/);
  await assert.rejects(() => wiki.writeIndex({ documents: [] }), /symlink|escapes root/);
});

test("WikiBundler rejects symlinked wiki index files before read or write", async () => {
  // Given
  const root = await makeRoot("tiny-chu-wiki-index-file-symlink-");
  const outside = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-wiki-index-file-outside-"));
  const outsideIndex = path.join(outside, "index.json");
  await writeFile(outsideIndex, `${JSON.stringify({ documents: [] })}\n`, "utf8");
  await symlink(outsideIndex, path.join(root, ".tiny", "wiki", "index.json"));
  const wiki = new WikiBundler(root);

  // When / Then
  await assert.rejects(() => wiki.readIndex(), /symlink/);
  await assert.rejects(() => wiki.writeIndex({ documents: [] }), /symlink/);
  assert.equal(await readFile(outsideIndex, "utf8"), `${JSON.stringify({ documents: [] })}\n`);
});
