import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTinyInfiPlugin, POWERSHELL_OPENCODE_RUNTIME, loadContextBundle, parsePlanMarkdown, PublicDispatcher, resolveTinyInfiPaths, TaskStore, WikiBundler } from "../dist/index.js";

test("TaskStore persists tasks under .tiny/tasks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-infi-task-"));
  const store = new TaskStore({ root, now: () => new Date("2026-06-12T00:00:00.000Z") });
  const task = await store.create({ title: "Keep TODO state" });
  assert.equal(task.id, "T-20260612T000000Z");
  assert.equal(resolveTinyInfiPaths(root).tasksDir, path.join(root, ".tiny", "tasks"));
  await access(path.join(root, ".tiny", "tasks", `${task.id}.json`));
  const paths = resolveTinyInfiPaths(root);
  assert.equal(paths.plansDir, path.join(root, ".tiny", "plans"));
  assert.equal(paths.publicJobsDir, path.join(root, ".tiny", "public-jobs"));
  assert.equal(paths.wikiIndexFile, path.join(root, ".tiny", "wiki", "index.json"));
  assert.equal((await store.list()).length, 1);
  const updated = await store.update(task.id, { status: "in_progress", notes: ["started"] });
  assert.equal(updated.status, "in_progress");
  assert.deepEqual((await store.get(task.id))?.notes, ["started"]);
});

test("PublicDispatcher applies soft rate gate and retry backoff", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-infi-dispatch-"));
  const dispatcher = new PublicDispatcher({ root, now: () => new Date("2026-06-12T00:00:00.000Z"), softRpm: 1, softTpm: 100, hardRpm: 2, hardTpm: 200 });
  const job = await dispatcher.dispatch({ prompt: "Analyze options" });
  assert.equal(job.status, "queued");
  assert.equal(dispatcher.recordUsage(50).allowed, true);
  assert.equal(dispatcher.checkRateGate(10).allowed, false);
  const retry = await dispatcher.retry(job.id, "429");
  assert.equal(retry.status, "retry_wait");
  assert.equal(retry.retryAt, "2026-06-12T00:00:15.000Z");
});

test("context loader prefers nearest AGENTS before rules", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-infi-context-"));
  await writeFile(path.join(root, "AGENTS.md"), "root rule", "utf8");
  await mkdir(path.join(root, "src", "feature"), { recursive: true });
  await writeFile(path.join(root, "src", "AGENTS.md"), "src rule", "utf8");
  await mkdir(path.join(root, ".tiny", "rules"), { recursive: true });
  await writeFile(path.join(root, ".tiny", "rules", "main.md"), "project rule", "utf8");
  const bundle = await loadContextBundle(root, "src/feature/file.ts");
  assert.deepEqual(bundle.documents.map((doc) => doc.path), ["src/AGENTS.md", "AGENTS.md", ".tiny/rules/main.md"]);
});

test("wiki bundler selects canonical docs and tag matches", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-infi-wiki-"));
  await mkdir(path.join(root, ".tiny", "wiki", "domains"), { recursive: true });
  await writeFile(path.join(root, ".tiny", "wiki", "domains", "backend.md"), "Backend truth", "utf8");
  const wiki = new WikiBundler(root);
  await wiki.upsertDocument({ id: "backend", path: ".tiny/wiki/domains/backend.md", canonical: true, tags: ["backend"], freshness: "manual" });
  const bundle = await wiki.bundle(["backend"]);
  assert.match(bundle.text, /Backend truth/);
});

test("tiny plugin injects context on ulw and continues unfinished plans", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-infi-plugin-"));
  await writeFile(path.join(root, "AGENTS.md"), "Always test", "utf8");
  await mkdir(path.join(root, ".tiny", "plans"), { recursive: true });
  await writeFile(path.join(root, ".tiny", "plans", "PLAN.md"), "# P\n\n## TODOs\n- [ ] one\n- [x] two\n", "utf8");
  const plugin = createTinyInfiPlugin({ root });
  const transformed = await plugin.hooks.transformUserMessage("ulw do it");
  assert.match(transformed, /tiny-infi-context/);
  assert.deepEqual(await plugin.hooks.onSessionIdle({ planRef: ".tiny/plans/PLAN.md" }), { shouldContinue: true, reason: "1 open checkbox item(s) remain" });
});

test("tiny plugin declares the OpenCode PowerShell runtime", () => {
  const plugin = createTinyInfiPlugin();
  assert.deepEqual(plugin.opencode, POWERSHELL_OPENCODE_RUNTIME);
  assert.deepEqual(plugin.opencode.shell, {
    name: "powershell",
    executable: "pwsh",
    version: "7.6.2",
    args: ["-NoLogo", "-NoProfile"],
  });
});

test("plan parser reports checkbox completion", () => {
  const status = parsePlanMarkdown("## TODOs\n- [x] a\n\n## Final Verification Wave\n- [ ] b", "PLAN.md");
  assert.equal(status.total, 2);
  assert.equal(status.done, 1);
  assert.equal(status.complete, false);
});
