import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTinyInfiPlugin } from "../dist/index.js";

test("context_digest returns bounded evidence snippets with line metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-infi-context-digest-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "feature.ts"), [
    "export function alpha() {",
    "  return 'alpha';",
    "}",
    "export function beta() {",
    "  return 'beta';",
    "}",
    "export function gamma() {",
    "  return 'gamma';",
    "}",
  ].join("\n"), "utf8");
  const plugin = createTinyInfiPlugin({ root });
  const digest = await plugin.tools.context_digest({
    targetPath: "src/feature.ts",
    query: "beta",
    maxSnippetChars: 28,
    maxSnippets: 1,
  });
  assert.deepEqual(digest.snippets, [{ file: "src/feature.ts", line: 4, text: "export function beta() {" }]);
  assert.ok(digest.snippets.every((snippet) => snippet.text.length <= 28));
  assert.doesNotMatch(JSON.stringify(digest), /gamma/);
});

test("resume_packet summarizes the latest active task checkpoint", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-infi-resume-packet-"));
  const plugin = createTinyInfiPlugin({ root });
  const task = await plugin.tools.task_create({ title: "Small-model resilience", priority: "high" });
  await plugin.tools.task_update({ id: task.id, status: "in_progress" });
  await plugin.tools.task_checkpoint({
    id: task.id,
    summary: "mapped the missing tool surface",
    nextSteps: ["add failing tests", "implement tools"],
    openQuestions: ["should digest use ripgrep-compatible globs?"],
  });
  const packet = await plugin.tools.resume_packet({ id: task.id });
  assert.equal(packet.activeGoal.id, task.id);
  assert.equal(packet.activeGoal.title, "Small-model resilience");
  assert.equal(packet.latestCheckpoint.summary, "mapped the missing tool surface");
  assert.deepEqual(packet.nextSteps, ["add failing tests", "implement tools"]);
  assert.deepEqual(packet.openQuestions, ["should digest use ripgrep-compatible globs?"]);
});

test("chunked_write_plan returns chunks bounded by maxChunkChars", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-infi-chunked-plan-"));
  const plugin = createTinyInfiPlugin({ root });
  const markdown = "# Plan\n\n- [ ] gather context\n- [ ] write tests\n- [ ] verify red\n";
  const plan = await plugin.tools.chunked_write_plan({
    path: ".tiny/plans/SMALL.md",
    markdown,
    maxChunkChars: 24,
  });
  assert.ok(plan.chunks.length > 1);
  assert.ok(plan.chunks.every((chunk) => chunk.text.length <= 24));
  assert.equal(plan.chunks.map((chunk) => chunk.text).join(""), markdown);
});
