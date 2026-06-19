import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendJsonLine, buildContextPacket, createTinyChuPlugin, POWERSHELL_OPENCODE_RUNTIME, POWERSHELL_TOOLING_PROFILE, renderPowerShellToolingGuide, loadContextBundle, parsePlanMarkdown, PublicDispatcher, readJsonLines, resolveTinyChuPaths, selectPlanFocus, TaskStore, WikiBundler, isPathInsideRoot, ARTIFACT_TYPES } from "../dist/index.js";
import { createPortableSymlink as symlink } from "./support/symlink.mjs";

test("TaskStore persists tasks under .tiny/tasks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-task-"));
  const store = new TaskStore({ root, now: () => new Date("2026-06-12T00:00:00.000Z") });
  const task = await store.create({ title: "Keep TODO state" });
  assert.equal(task.id, "T-20260612T000000Z");
  assert.equal(resolveTinyChuPaths(root).tasksDir, path.join(root, ".tiny", "tasks"));
  await access(path.join(root, ".tiny", "tasks", `${task.id}.json`));
  const paths = resolveTinyChuPaths(root);
  assert.equal(paths.plansDir, path.join(root, ".tiny", "plans"));
  assert.equal(paths.publicJobsDir, path.join(root, ".tiny", "public-jobs"));
  assert.equal(paths.wikiIndexFile, path.join(root, ".tiny", "wiki", "index.json"));
  assert.equal((await store.list()).length, 1);
  const updated = await store.update(task.id, { status: "in_progress", notes: ["started"] });
  assert.equal(updated.status, "in_progress");
  assert.deepEqual((await store.get(task.id))?.notes, ["started"]);
});

test("TaskStore normalizes legacy tasks before checkpointing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-legacy-task-"));
  await mkdir(path.join(root, ".tiny", "tasks"), { recursive: true });
  await writeFile(path.join(root, ".tiny", "tasks", "T-legacy.json"), JSON.stringify({
    id: "T-legacy",
    title: "Legacy task",
    status: "todo",
    priority: "normal",
    notes: [],
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
    evidenceRefs: [],
    publicJobIds: [],
  }), "utf8");
  const store = new TaskStore({ root, now: () => new Date("2026-06-12T00:01:00.000Z") });
  assert.deepEqual((await store.get("T-legacy"))?.checkpoints, []);
  assert.equal((await store.list())[0].checkpoints.length, 0);
  await store.checkpoint("T-legacy", { summary: "resume here" });
  assert.equal((await store.get("T-legacy"))?.checkpoints.length, 1);
});

test("TaskStore rejects path-like ids", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-task-id-"));
  const store = new TaskStore({ root });
  await assert.rejects(() => store.get("../../package-lock"), /Invalid task id/);
  await assert.rejects(() => store.update("../../package-lock", { status: "done" }), /Invalid task id/);
  await assert.rejects(() => store.checkpoint("../../package-lock", { summary: "no" }), /Invalid task id/);
});

test("PublicDispatcher applies soft rate gate and retry backoff", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-dispatch-"));
  const dispatcher = new PublicDispatcher({ root, now: () => new Date("2026-06-12T00:00:00.000Z"), softRpm: 1, softTpm: 100, hardRpm: 2, hardTpm: 200 });
  const job = await dispatcher.dispatch({ prompt: "Analyze options" });
  assert.equal(job.status, "queued");
  assert.equal(dispatcher.recordUsage(50).allowed, true);
  assert.equal(dispatcher.checkRateGate(10).allowed, false);
  const retry = await dispatcher.retry(job.id, "429");
  assert.equal(retry.status, "retry_wait");
  assert.equal(retry.retryAt, "2026-06-12T00:00:15.000Z");
});

test("tiny plugin preserves public job artifact contracts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-public-contract-"));
  const plugin = createTinyChuPlugin({ root });
  const job = await plugin.tools.public_dispatch({
    prompt: "Draft AS-IS artifact from evidence",
    artifactType: "as_is",
    mustReturn: ["artifactMarkdown", "citations", "uncertainties", "verificationCommands", "nextSteps"],
  });
  assert.equal(job.contract.artifactType, "as_is");
  assert.deepEqual(job.contract.mustReturn, ["artifactMarkdown", "citations", "uncertainties", "verificationCommands", "nextSteps"]);
  assert.deepEqual((await plugin.tools.public_collect({ id: job.id })).contract.mustReturn, job.contract.mustReturn);
});

test("public wikiRefs stay metadata-only and context_packet schema stays unchanged", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-public-wikirefs-"));
  await mkdir(path.join(root, ".tiny", "wiki", "domains"), { recursive: true });
  await writeFile(path.join(root, ".tiny", "wiki", "domains", "api.md"), "Private wiki body: do not inline this text.\n", "utf8");
  const plugin = createTinyChuPlugin({ root });
  const job = await plugin.tools.public_dispatch({ prompt: "Analyze API policy", wikiRefs: ["api"], mustReturn: ["findings"] });
  await plugin.tools.public_checkpoint({ id: job.id, summary: "worker paused", result: "partial result without wiki body" });
  const resume = await plugin.tools.public_job_resume_packet({ id: job.id });
  const packet = await plugin.tools.context_packet({ targetPath: ".", maxChars: 1200 });

  assert.deepEqual((await plugin.tools.public_collect({ id: job.id })).context.wikiRefs, ["api"]);
  assert.doesNotMatch(resume.resumePrompt, /Private wiki body/);
  assert.equal(Object.hasOwn(packet, "wikiRefs"), false);
  assert.equal(Object.hasOwn(packet, "wikiQuery"), false);
  assert.equal(Object.hasOwn(packet, "wikiContext"), false);
});

test("public worker supports json lifecycle and completion", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-public-json-"));
  const plugin = createTinyChuPlugin({ root });
  const markdown = await plugin.tools.public_dispatch({ prompt: "default public worker" });
  assert.equal(markdown.contract.format, "markdown_sections");
  const json = await plugin.tools.public_dispatch({ prompt: "one button", format: "json", mustReturn: ["buttonId", "traceRows"] });
  assert.equal(json.contract.format, "json");
  const done = await plugin.tools.public_complete({ id: json.id, result: JSON.stringify({ ok: true }) });
  assert.equal(done.status, "done");
  assert.equal(done.result, JSON.stringify({ ok: true }));
  await assert.rejects(() => plugin.tools.public_dispatch({ prompt: "bad", format: "xml" }), /Invalid public job format/);
});

test("PublicDispatcher rejects path-like ids", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-public-id-"));
  const dispatcher = new PublicDispatcher({ root });
  await assert.rejects(() => dispatcher.get("../../package-lock"), /Invalid public job id/);
  await assert.rejects(() => dispatcher.retry("../../package-lock"), /Invalid public job id/);
  await assert.rejects(() => dispatcher.cancel("../../package-lock"), /Invalid public job id/);
});

test("context loader prefers nearest AGENTS before rules", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-context-"));
  await writeFile(path.join(root, "AGENTS.md"), "root rule", "utf8");
  await mkdir(path.join(root, "src", "feature"), { recursive: true });
  await writeFile(path.join(root, "src", "AGENTS.md"), "src rule", "utf8");
  await mkdir(path.join(root, ".tiny", "rules"), { recursive: true });
  await writeFile(path.join(root, ".tiny", "rules", "main.md"), "project rule", "utf8");
  const bundle = await loadContextBundle(root, "src/feature/file.ts");
  assert.deepEqual(bundle.documents.map((doc) => doc.path), ["src/AGENTS.md", "AGENTS.md", ".tiny/rules/main.md"]);
});

test("context loader rejects adjacent prefix targets", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-context-prefix-"));
  const root = path.join(parent, "repo");
  const adjacent = path.join(parent, "repo-evil");
  await mkdir(root, { recursive: true });
  await mkdir(adjacent, { recursive: true });
  await writeFile(path.join(root, "AGENTS.md"), "root rule", "utf8");
  await writeFile(path.join(adjacent, "AGENTS.md"), "evil rule", "utf8");
  const bundle = await loadContextBundle(root, adjacent);
  assert.deepEqual(bundle.documents.map((doc) => doc.content), ["root rule"]);
});

test("wiki bundler selects canonical docs and tag matches", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-wiki-"));
  await mkdir(path.join(root, ".tiny", "wiki", "domains"), { recursive: true });
  await writeFile(path.join(root, ".tiny", "wiki", "domains", "backend.md"), "Backend truth", "utf8");
  const wiki = new WikiBundler(root);
  await wiki.upsertDocument({ id: "backend", path: ".tiny/wiki/domains/backend.md", canonical: true, tags: ["backend"], freshness: "manual" });
  const bundle = await wiki.bundle(["backend"]);
  assert.match(bundle.text, /Backend truth/);
});

test("tiny plugin injects context on ulw and continues unfinished plans", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-plugin-"));
  await writeFile(path.join(root, "AGENTS.md"), "Always test", "utf8");
  await mkdir(path.join(root, ".tiny", "plans"), { recursive: true });
  await writeFile(path.join(root, ".tiny", "plans", "PLAN.md"), "# P\n\n## TODOs\n- [ ] one\n- [x] two\n", "utf8");
  const plugin = createTinyChuPlugin({ root });
  const transformed = await plugin.hooks.transformUserMessage("ulw do it");
  assert.match(transformed, /tiny-chu-context/);
  assert.match(transformed, /tiny-chu-powershell-tooling/);
  assert.match(transformed, /Quote jq\/yq\/mdq\/rg\/fd\/ast-grep patterns with single quotes/);
  assert.deepEqual(await plugin.hooks.onSessionIdle({ planRef: ".tiny/plans/PLAN.md" }), { shouldContinue: true, reason: "1 open checkbox item(s) remain" });
});

test("tiny plugin injects bounded context packet for ultrawork prompts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-packet-hook-"));
  await writeFile(path.join(root, "AGENTS.md"), `Always test\n${"X".repeat(20_000)}`, "utf8");
  const plugin = createTinyChuPlugin({ root });
  const plain = await plugin.hooks.transformUserMessage("plain question");
  assert.equal(plain, "plain question");
  const packet = await plugin.tools.context_packet({ targetPath: ".", maxChars: 1200, evidenceRefs: ["AGENTS.md:1"] });
  assert.equal(packet.evidence[0].ref, "AGENTS.md:1");
  assert.ok(packet.truncated);
  const transformed = await plugin.hooks.transformUserMessage("ulw continue");
  assert.match(transformed, /tiny-chu-context/);
  assert.match(transformed, /contextPacket/);
  assert.match(transformed, /truncated/);
  assert.ok(transformed.length <= 16_000);
});

test("tiny plugin declares the OpenCode PowerShell runtime", () => {
  const plugin = createTinyChuPlugin();
  assert.deepEqual(plugin.opencode, POWERSHELL_OPENCODE_RUNTIME);
  assert.deepEqual(plugin.opencode.shell, {
    name: "powershell",
    executable: "pwsh",
    version: "7.6.2",
    args: ["-NoLogo", "-NoProfile"],
  });
  assert.equal(plugin.opencode.tooling, POWERSHELL_TOOLING_PROFILE);
  assert.deepEqual(plugin.opencode.tooling.nativeTools.map((tool) => tool.name), ["jq", "yq", "mdq", "fd", "ast-grep", "ripgrep"]);
});

test("tiny plugin exposes a small-context orchestration profile", async () => {
  const plugin = createTinyChuPlugin();
  const profile = await plugin.tools.orchestration_profile({});
  assert.equal(profile.runtime.shell.version, "7.6.2");
  assert.equal(profile.models.foreman.provider, "ollama");
  assert.match(profile.models.foreman.model, /gemma4/i);
  assert.match(profile.models.delegate.model, /qwen3\.6.*35b.*a3b/i);
  assert.deepEqual(profile.contextStrategy.nativeTools.map((tool) => tool.name), ["fd", "ripgrep", "ast-grep", "jq", "yq", "mdq", "mermaid-cli"]);
  assert.match(profile.continuationProtocol.checkpointTemplate, /nextSteps/);
  assert.match(profile.mermaid.workflow, /mmdc/);
  assert.equal(profile.auditLoop.totalPasses, 20);
  assert.deepEqual(profile.artifacts.map((artifact) => artifact.type), ARTIFACT_TYPES);
  assert.match(profile.antiHallucination.rules.join("\n"), /Every claim must cite/);
  assert.match(profile.delegatePacket.mustReturn.join("\n"), /uncertainties/);
  assert.ok(profile.packetStrategy.maxContextChars > 0);
  assert.ok(profile.packetStrategy.tools.includes("context_packet"));
  assert.ok(profile.packetStrategy.tools.includes("task_focus_packet"));
  assert.ok(profile.agentTemplates.foreman);
});

test("tiny plugin persists task checkpoints for continuation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-checkpoint-"));
  const plugin = createTinyChuPlugin({ root });
  const task = await plugin.tools.task_create({ title: "Analyze repository" });
  const checkpoint = await plugin.tools.task_checkpoint({
    id: task.id,
    summary: "scanned files with fd and selected entry points",
    artifactType: "as_is",
    passIndex: 7,
    nextSteps: ["run ast-grep on plugin tools", "draft Mermaid architecture"],
    evidenceRefs: ["fd://src/**/*.ts"],
    openQuestions: ["which Qwen worker contract should be public?"],
    verificationCommands: ["rg --json createTinyChuPlugin src"],
  });
  assert.equal(checkpoint.sequence, 1);
  assert.equal(checkpoint.artifactType, "as_is");
  assert.equal(checkpoint.passIndex, 7);
  const persisted = await plugin.tools.task_get({ id: task.id });
  assert.equal(persisted.checkpoints.length, 1);
  assert.deepEqual(persisted.checkpoints[0].nextSteps, ["run ast-grep on plugin tools", "draft Mermaid architecture"]);
  assert.deepEqual(persisted.checkpoints[0].verificationCommands, ["rg --json createTinyChuPlugin src"]);
  const focus = await plugin.tools.task_focus_packet({ id: task.id, maxOpenItems: 1 });
  assert.equal(focus.found, true);
  assert.equal(focus.latestCheckpoint.summary, "scanned files with fd and selected entry points");
});

test("TaskStore stores growing checkpoints in a sidecar", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-sidecar-"));
  let tick = 0;
  const store = new TaskStore({ root, now: () => new Date(Date.UTC(2026, 5, 12, 0, 0, tick++)) });
  const task = await store.create({ title: "Large checkpoint history" });
  for (let index = 0; index < 25; index += 1) {
    await store.checkpoint(task.id, { summary: `checkpoint ${index} ${"x".repeat(1000)}`, evidenceRefs: [`evidence-${index}.txt`] });
  }
  const taskFile = path.join(root, ".tiny", "tasks", `${task.id}.json`);
  const sidecar = path.join(root, ".tiny", "tasks", `${task.id}.checkpoints.jsonl`);
  const [taskSize, sidecarSize, persisted] = await Promise.all([stat(taskFile), stat(sidecar), store.get(task.id)]);
  assert.ok(taskSize.size < sidecarSize.size);
  assert.equal(persisted?.checkpoints.length, 25);
  assert.equal((await store.list())[0].checkpoints.length, 25);
});

test("context packet bounds evidence and rejects outside-root refs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-context-packet-"));
  await writeFile(path.join(root, "AGENTS.md"), "A".repeat(5000), "utf8");
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "a.ts"), ["export const one = 1;", "export const two = 2;", "export const three = 3;"].join("\n"), "utf8");
  const packet = await buildContextPacket({ root, targetPath: "src/a.ts", maxChars: 1200, evidenceRefs: ["src/a.ts:2"] });
  assert.ok(JSON.stringify(packet).length <= 1400);
  assert.equal(packet.truncated, true);
  assert.equal(packet.evidence[0].ref, "src/a.ts:2");
  assert.match(packet.evidence[0].text, /two/);
  await assert.rejects(() => buildContextPacket({ root, targetPath: ".", evidenceRefs: ["../secret.ts:1"] }), /outside configured root|outside root/);
});

test("jsonl sidecar helpers append and read ordered records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-jsonl-"));
  const file = path.join(root, "records.jsonl");
  await appendJsonLine(file, { sequence: 1, summary: "one" });
  await appendJsonLine(file, { sequence: 2, summary: "two" });
  const records = await readJsonLines(file, []);
  assert.deepEqual(records.map((item) => item.sequence), [1, 2]);
  await writeFile(file, "{\"ok\":true}\nnot-json\n", "utf8");
  await assert.rejects(() => readJsonLines(file, []), /line 2/);
});

test("artifact checker rejects hallucination-prone uncited artifacts", async () => {
  const plugin = createTinyChuPlugin();
  const result = await plugin.tools.artifact_check({
    artifactType: "as_is",
    markdown: "AS-IS: everything is implemented. No citations.",
    evidenceRefs: [],
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), ["missing_evidence_refs", "missing_required_section"]);
});

test("artifact checker validates Mermaid-backed artifact syntax", async () => {
  const plugin = createTinyChuPlugin();
  const result = await plugin.tools.artifact_check({
    artifactType: "sequence_diagram",
    markdown: "Source: src/opencode/tiny-plugin.ts:1\n\n```mermaid\nsequenceDiagram\nAlice->>\n```\n",
    evidenceRefs: ["src/opencode/tiny-plugin.ts:1"],
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), ["mermaid_syntax_error"]);
});

test("artifact_format_template returns built-in and file-backed templates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-artifact-template-"));
  const plugin = createTinyChuPlugin({ root });
  const builtin = await plugin.tools.artifact_format_template({ artifactType: "as_is" });
  assert.equal(builtin.artifactType, "as_is");
  assert.equal(builtin.source, "builtin");
  assert.ok(builtin.requiredSections.includes("Evidence"));
  assert.match(builtin.templateMarkdown, /## Evidence/);
  const flowchart = await plugin.tools.artifact_format_template({ artifactType: "flowchart" });
  assert.ok(flowchart.acceptedMermaidDeclarations.includes("flowchart") || flowchart.acceptedMermaidDeclarations.includes("graph"));
  await mkdir(path.join(root, ".tiny", "artifacts", "templates"), { recursive: true });
  await writeFile(path.join(root, ".tiny", "artifacts", "templates", "flowchart.md"), "# Custom Flow\n", "utf8");
  const override = await plugin.tools.artifact_format_template({ artifactType: "flowchart" });
  assert.equal(override.source, "file");
  assert.equal(override.templatePath, ".tiny/artifacts/templates/flowchart.md");
  assert.equal(override.templateMarkdown, "# Custom Flow\n");
  const unknown = await plugin.tools.artifact_format_template({ artifactType: "unknown" });
  assert.equal(unknown.valid, false);
  assert.deepEqual(unknown.diagnostics.map((diagnostic) => diagnostic.code), ["unknown_artifact_type"]);
});

test("mermaid checker reports broken fences and normalizes markdown", async () => {
  const plugin = createTinyChuPlugin();
  const broken = "```Mermaid\nflowchart TD\nA-->B\n";
  const result = await plugin.tools.mermaid_check({ markdown: broken });
  assert.equal(result.valid, false);
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), ["non_normalized_fence", "unclosed_fence"]);
  const fixed = await plugin.tools.mermaid_fix({ markdown: broken });
  assert.match(fixed.markdown, /^```mermaid\nflowchart TD\nA-->B\n```\n$/);
  assert.equal(fixed.valid, true);
});

test("mermaid checker rejects obvious diagram syntax errors", async () => {
  const plugin = createTinyChuPlugin();
  const result = await plugin.tools.mermaid_check({ markdown: "```mermaid\nflowchart TD\nA -->\n```\n" });
  assert.equal(result.valid, false);
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), ["syntax_error"]);
});

test("mermaid path input is confined to the configured root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-mermaid-root-"));
  const outside = path.join(os.tmpdir(), "tiny-chu-outside.md");
  await writeFile(outside, "```mermaid\nflowchart TD\nA-->B\n```\n", "utf8");
  const plugin = createTinyChuPlugin({ root });
  await assert.rejects(() => plugin.tools.mermaid_check({ path: outside }), /outside configured root/);
  await assert.rejects(() => plugin.tools.mermaid_fix({ path: "../outside.md" }), /outside configured root/);
  await assert.rejects(() => plugin.tools.mermaid_check({ path: "D:\\outside.md" }), /outside configured root/);
  await assert.rejects(() => plugin.tools.mermaid_fix({ path: "\\\\server\\share\\outside.md" }), /outside configured root/);
});

test("mermaid path input rejects symlink escapes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-mermaid-symlink-"));
  const outside = path.join(os.tmpdir(), "tiny-chu-outside-secret.md");
  await writeFile(outside, "outside-secret-content", "utf8");
  await symlink(outside, path.join(root, "leak.md"));
  const plugin = createTinyChuPlugin({ root });
  await assert.rejects(() => plugin.tools.mermaid_fix({ path: "leak.md" }), /outside configured root/);
  await assert.rejects(() => plugin.tools.artifact_check({ artifactType: "flowchart", path: "leak.md", evidenceRefs: ["leak.md"] }), /outside configured root/);
});

test("path confinement rejects Windows cross-drive absolute paths", () => {
  assert.equal(isPathInsideRoot("C:\\repo", "C:\\repo\\docs\\diagram.md"), true);
  assert.equal(isPathInsideRoot("C:\\repo", "D:\\outside.md"), false);
  assert.equal(isPathInsideRoot("C:\\repo", "\\\\server\\share\\outside.md"), false);
});

test("PowerShell tooling guide captures native command safety defaults", () => {
  const guide = renderPowerShellToolingGuide();
  assert.match(guide, /PowerShell native-tool guide/);
  assert.match(guide, /\$PSNativeCommandArgumentPassing = 'Standard'/);
  assert.match(guide, /rg --files -g '\*\.ts' -g '!dist\/\*\*'/);
  assert.equal(POWERSHELL_TOOLING_PROFILE.environment.NO_COLOR, "1");
});

test("plan parser reports checkbox completion", () => {
  const status = parsePlanMarkdown("## TODOs\n- [x] a\n\n## Final Verification Wave\n- [ ] b", "PLAN.md");
  assert.equal(status.total, 2);
  assert.equal(status.done, 1);
  assert.equal(status.complete, false);
  const focus = selectPlanFocus(status, { maxOpenItems: 1 });
  assert.equal(focus.open, 1);
  assert.equal(focus.nextOpenItems[0].text, "b");
  assert.equal(focus.finalVerificationOpen, true);
});
