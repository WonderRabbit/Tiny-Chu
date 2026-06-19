import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTinyChuPlugin, loadContextBundle, readPlanStatus } from "../dist/index.js";
import { createPortableSymlink as symlink } from "./support/symlink.mjs";

test("context loader skips AGENTS and rules whose realpath escapes root", async () => {
  // Given
  const parent = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-context-escape-"));
  const root = path.join(parent, "repo");
  const outside = path.join(parent, "outside");
  await mkdir(path.join(root, "src", "feature"), { recursive: true });
  await mkdir(path.join(root, ".tiny", "rules"), { recursive: true });
  await mkdir(path.join(root, ".github"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(root, "AGENTS.md"), "root agents", "utf8");
  await writeFile(path.join(outside, "AGENTS.md"), "outside agents", "utf8");
  await writeFile(path.join(outside, "rule.md"), "outside rule", "utf8");
  await writeFile(path.join(outside, "copilot.md"), "outside copilot", "utf8");
  await symlink(path.join(outside, "AGENTS.md"), path.join(root, "src", "AGENTS.md"));
  await symlink(path.join(outside, "rule.md"), path.join(root, ".tiny", "rules", "escape.md"));
  await symlink(path.join(outside, "copilot.md"), path.join(root, ".github", "copilot-instructions.md"));

  // When
  const bundle = await loadContextBundle(root, "src/feature/file.ts");

  // Then
  assert.deepEqual(bundle.documents.map((doc) => doc.path), ["AGENTS.md"]);
  assert.equal(bundle.documents[0].content, "root agents");
  assert.doesNotMatch(bundle.text, /outside/);
});

test("context loader preserves inside-root symlinks and nearest AGENTS precedence", async () => {
  // Given
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-context-inside-link-"));
  await mkdir(path.join(root, "src", "feature"), { recursive: true });
  await mkdir(path.join(root, "context-docs"), { recursive: true });
  await mkdir(path.join(root, "rule-docs"), { recursive: true });
  await mkdir(path.join(root, ".tiny", "rules"), { recursive: true });
  await writeFile(path.join(root, "AGENTS.md"), "root agents", "utf8");
  await writeFile(path.join(root, "context-docs", "src-agents.md"), "src agents via symlink", "utf8");
  await writeFile(path.join(root, "rule-docs", "first.md"), "first rule via symlink", "utf8");
  await writeFile(path.join(root, ".tiny", "rules", "second.md"), "second rule", "utf8");
  await symlink(path.join(root, "context-docs", "src-agents.md"), path.join(root, "src", "AGENTS.md"));
  await symlink(path.join(root, "rule-docs", "first.md"), path.join(root, ".tiny", "rules", "first.md"));

  // When
  const bundle = await loadContextBundle(root, "src/feature/file.ts");

  // Then
  assert.deepEqual(bundle.documents.map((doc) => doc.path), [
    "src/AGENTS.md",
    "AGENTS.md",
    ".tiny/rules/first.md",
    ".tiny/rules/second.md",
  ]);
  assert.deepEqual(bundle.documents.map((doc) => doc.content), [
    "src agents via symlink",
    "root agents",
    "first rule via symlink",
    "second rule",
  ]);
});

test("plan status and task focus reject absolute and symlinked outside-root plan refs", async () => {
  // Given: an outside Markdown plan is reachable by both absolute path and an inside-root symlink.
  const parent = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-planref-escape-"));
  const root = path.join(parent, "repo");
  const outside = path.join(parent, "outside");
  await mkdir(path.join(root, ".tiny", "plans"), { recursive: true });
  await mkdir(outside, { recursive: true });
  const outsidePlan = path.join(outside, "secret-plan.md");
  await writeFile(outsidePlan, "## Secret\n- [ ] secret open item\n", "utf8");
  await symlink(outsidePlan, path.join(root, ".tiny", "plans", "linked-secret.md"));
  const tiny = createTinyChuPlugin({ root });
  const task = await tiny.tools.task_create({ title: "Read plan safely", planRef: ".tiny/plans/linked-secret.md" });

  // When/Then: direct plan reads and task focus packets fail closed without returning outside checkbox text.
  await assert.rejects(() => readPlanStatus(root, outsidePlan), /plan/i);
  await assert.rejects(() => readPlanStatus(root, ".tiny/plans/linked-secret.md"), /plan/i);
  await assert.rejects(() => tiny.tools.task_focus_packet({ id: task.id }), /plan/i);
});
