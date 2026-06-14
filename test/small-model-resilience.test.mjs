import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTinyChuPlugin } from "../dist/index.js";

async function publicJobCount(root) {
  const files = await readdir(path.join(root, ".tiny", "public-jobs")).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return files.filter((file) => file.endsWith(".json")).length;
}

test("context_digest returns bounded evidence snippets with line metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-context-digest-"));
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
  const plugin = createTinyChuPlugin({ root });
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
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-resume-packet-"));
  const plugin = createTinyChuPlugin({ root });
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
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-chunked-plan-"));
  const plugin = createTinyChuPlugin({ root });
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

test("atomic markdown write prevents empty overwrite and bak churn", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-atomic-write-"));
  const plugin = createTinyChuPlugin({ root });
  const written = await plugin.tools.atomic_markdown_write({ path: ".tiny/artifacts/report.md", markdown: "# Report\n\nbody\n" });
  assert.equal(written.decision, "allow");
  assert.equal(await readFile(path.join(root, ".tiny", "artifacts", "report.md"), "utf8"), "# Report\n\nbody\n");
  assert.ok(!(await readdir(path.join(root, ".tiny", "artifacts"))).some((file) => file.endsWith(".bak")));
  const identical = await plugin.tools.write_loop_guard({ path: ".tiny/artifacts/report.md", markdown: "# Report\n\nbody\n", previousChecksum: written.checksum });
  assert.equal(identical.decision, "skip_identical");
  const empty = await plugin.tools.write_loop_guard({ path: ".tiny/artifacts/report.md", markdown: "" });
  assert.equal(empty.decision, "block_empty_overwrite");
  await assert.rejects(() => plugin.tools.atomic_markdown_write({ path: "../outside.md", markdown: "# bad" }), /outside configured root/);
});

test("tool_usage_plan gives a bounded small-model command sequence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-tool-plan-"));
  const plugin = createTinyChuPlugin({ root });
  const plan = await plugin.tools.tool_usage_plan({
    objective: "trace a web button to database write and produce a flowchart",
    artifactType: "flowchart",
  });
  assert.equal(plan.objective, "trace a web button to database write and produce a flowchart");
  assert.ok(plan.modelBudget.maxInputTokens <= 1800);
  assert.ok(plan.steps.length <= 8);
  assert.ok(plan.steps.some((step) => step.nativeTool === "fd"));
  assert.ok(plan.steps.some((step) => step.tinyTool === "legacy_repo_index"));
  assert.ok(plan.steps.some((step) => step.tinyTool === "ui_action_trace"));
  assert.ok(plan.steps.some((step) => step.tinyTool === "api_backend_trace"));
  assert.ok(plan.steps.some((step) => step.tinyTool === "integration_catalog"));
  assert.ok(plan.steps.some((step) => step.tinyTool === "traceability_matrix"));
  assert.ok(plan.steps.some((step) => step.tinyTool === "evidence_qa"));
  assert.deepEqual(plan.verification.requiredTools, ["evidence_qa", "claim_evidence_check", "artifact_check", "task_checkpoint"]);
  assert.ok(plan.verification.requiredAfterWork);
  assert.ok(plan.steps.some((step) => step.tinyTool === "artifact_format_template"));
});

test("transformUserMessage injects compact small-model guidance instead of the full profile", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-compact-hook-"));
  const plugin = createTinyChuPlugin({ root });
  const transformed = await plugin.hooks.transformUserMessage("ulw analyze the linked UX and backend flow", { targetPath: "." });
  assert.match(transformed, /tiny-chu-small-context/);
  assert.match(transformed, /profileMode: compact/);
  assert.match(transformed, /omittedContextPasses:/);
  assert.match(transformed, /Quote jq\/yq\/mdq\/rg\/fd\/ast-grep patterns with single quotes/);
  assert.match(transformed, /tool_usage_plan/);
  assert.match(transformed, /artifact_format_template/);
  assert.doesNotMatch(transformed, /## Artifact contracts/);
  assert.doesNotMatch(transformed, /### jq \(jq\)/);
  assert.ok(transformed.length < 6000);
});

test("orchestration_profile exposes small-context operating mode", async () => {
  const plugin = createTinyChuPlugin();
  const profile = await plugin.tools.orchestration_profile({});
  const mode = profile.smallContextRun ?? profile.operatingModes?.smallContextRun;

  assert.equal(mode?.mode, "small_context");
  assert.equal(mode?.noLiveProviderCalls, true);
  assert.equal(profile.models.foreman.model, "gemma4-small");
  assert.equal(profile.models.delegate.model, "qwen3.6-35b-a3b");
  assert.equal(mode.models.delegate.runtimeModel, "qwen3.6-35b-a3b");
  assert.equal(mode.models.delegate.officialModel, "Qwen3.6-35B-A3B");
  assert.deepEqual(mode.correctionWorkflow.map((step) => step.tinyTool), [
    "doctor",
    "session_preflight",
    "context_packet",
    "incremental_evidence_cache",
    "tool_usage_plan",
    "worker_packet_optimizer",
    "qwen_retry_policy",
    "claim_evidence_check",
    "artifact_pack_manifest",
    "task_checkpoint",
  ]);
  assert.ok(mode.requiredFirstTools.includes("doctor"));
  assert.ok(mode.requiredFirstTools.includes("context_packet"));
  assert.ok(mode.requiredFirstTools.includes("tool_usage_plan"));
  assert.ok(mode.requiredFirstTools.includes("claim_evidence_check"));
  assert.match(mode.dirtyWorktreePolicy.commandChecklist.join("\n"), /git status --short/);
  assert.match(mode.dirtyWorktreePolicy.commandChecklist.join("\n"), /git diff -- <file>/);
});

test("worker_packet_optimizer is packet-only by default", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-worker-packet-only-"));
  const plugin = createTinyChuPlugin({ root });

  const defaultPacket = await plugin.tools.worker_packet_optimizer({
    objective: "Analyze order flow without queueing public work",
    evidenceRefs: ["src/ui/OrderPage.jsx:2", "src/api/orderClient.js:3"],
  });
  assert.equal(await publicJobCount(root), 0);
  assert.equal(defaultPacket.noLiveProviderCalls, true);
  assert.equal(defaultPacket.dispatchMode, "packet_only");
  assert.equal(defaultPacket.dispatch.requested, false);
  assert.deepEqual(defaultPacket.dispatch.publicJobIds, []);

  const explicitPacketOnly = await plugin.tools.worker_packet_optimizer({
    objective: "Analyze order flow without queueing public work",
    evidenceRefs: ["src/ui/OrderPage.jsx:2", "src/api/orderClient.js:3"],
    dispatch: false,
  });
  assert.equal(await publicJobCount(root), 0);
  assert.equal(explicitPacketOnly.noLiveProviderCalls, true);
  assert.equal(explicitPacketOnly.dispatchMode, "packet_only");
  assert.equal(explicitPacketOnly.dispatch.requested, false);
  assert.deepEqual(explicitPacketOnly.dispatch.publicJobIds, []);
  assert.ok(explicitPacketOnly.ratePlan.requestsPerMinute > 0);
  assert.equal(explicitPacketOnly.dispatchOrder.length, explicitPacketOnly.packets.length);
  assert.equal(explicitPacketOnly.packets[0].retryPolicyInput.status, "queued");
});

test("tool_usage_plan emits small-context correction workflow", async () => {
  const plugin = createTinyChuPlugin();
  const plan = await plugin.tools.tool_usage_plan({
    objective: "correct a small-context operating-mode breach after a live provider call was suggested",
  });

  assert.ok(plan.steps.length <= 8);
  assert.ok(plan.steps.some((step) => step.tinyTool === "doctor"));
  assert.ok(plan.steps.some((step) => step.tinyTool === "session_preflight"));
  assert.ok(plan.steps.some((step) => step.tinyTool === "context_packet"));
  assert.ok(plan.steps.some((step) => step.tinyTool === "incremental_evidence_cache"));
  assert.ok(plan.steps.some((step) => step.tinyTool === "worker_packet_optimizer"));
  assert.ok(plan.verification.requiredTools.includes("claim_evidence_check"));
  assert.ok(plan.verification.requiredTools.includes("artifact_pack_manifest"));
  assert.ok(plan.verification.requiredTools.includes("task_checkpoint"));
  assert.ok(plan.stopRules.some((rule) => /no live provider calls/i.test(rule)));
  assert.ok(plan.stopRules.some((rule) => rule.includes("worker_packet_optimizer") && rule.includes("dispatch:false")));
});

test("incremental evidence cache does not claim git dirtiness", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-evidence-cache-hash-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "feature.ts"), "export const value = 'before';\n", "utf8");
  const plugin = createTinyChuPlugin({ root });

  const first = await plugin.tools.incremental_evidence_cache({ targetPath: "src/feature.ts" });
  await writeFile(path.join(root, "src", "feature.ts"), "export const value = 'after';\n", "utf8");
  const second = await plugin.tools.incremental_evidence_cache({ targetPath: "src/feature.ts", previous: first });

  assert.ok(second.staleReasons.length > 0);
  assert.ok(second.staleReasons.every((reason) => /sha256|content hash/i.test(reason)));
  assert.doesNotMatch(JSON.stringify(second), /dirtyWorktree|git dirt/i);
});

test("docs describe the small-context operating-mode correction gate", async () => {
  const docs = `${await readFile("README.md", "utf8")}\n${await readFile("HOW_TO_USE.md", "utf8")}`;
  const required = [
    "Small-context operating-mode correction gate",
    "doctor",
    "session_preflight",
    "context_packet",
    "incremental_evidence_cache",
    "tool_usage_plan",
    "worker_packet_optimizer",
    "dispatch: false",
    "qwen_retry_policy",
    "claim_evidence_check",
    "artifact_pack_manifest",
    "task_checkpoint",
    "git status --short",
    "git diff -- <file>",
    "source hash staleness",
    "no live provider call",
  ];
  assert.deepEqual(required.filter((item) => !docs.includes(item)), []);
});

test("tool_usage_plan adds qwen retry policy for delegated public work", async () => {
  const plugin = createTinyChuPlugin();
  const plan = await plugin.tools.tool_usage_plan({
    objective: "delegate qwen analysis and recover from rate limit",
  });
  assert.ok(plan.steps.length <= 8);
  assert.ok(plan.steps.some((step) => step.tinyTool === "qwen_retry_policy"));
  assert.ok(plan.stopRules.some((rule) => rule.includes("public Qwen failures")));
});

test("tool_usage_plan keeps qwen retry policy for delegated Mermaid artifacts", async () => {
  const plugin = createTinyChuPlugin();
  const plan = await plugin.tools.tool_usage_plan({
    objective: "delegate qwen analysis and produce a flowchart",
    artifactType: "flowchart",
  });
  assert.ok(plan.steps.length <= 8);
  assert.ok(plan.steps.some((step) => step.tinyTool === "mermaid_check"));
  assert.ok(plan.steps.some((step) => step.tinyTool === "qwen_retry_policy"));
  assert.ok(plan.steps.findIndex((step) => step.tinyTool === "artifact_format_template") < plan.steps.findIndex((step) => step.tinyTool === "artifact_check"));
  assert.deepEqual(plan.verification.requiredTools, ["trace_diagram_render", "artifact_check", "mermaid_check", "task_checkpoint"]);
  assert.ok(plan.verification.requiredAfterWork);
});

test("tool_usage_plan preserves verification for delegated legacy trace workflows", async () => {
  const plugin = createTinyChuPlugin();
  const plan = await plugin.tools.tool_usage_plan({
    objective: "delegate qwen to trace UI button through saga API backend MyBatis RFC and produce a flowchart",
    artifactType: "flowchart",
  });
  assert.ok(plan.steps.length <= 8);
  assert.ok(plan.omittedSteps > 0);
  assert.ok(plan.deterministicCaps.some((cap) => cap.name === "context_digest" && cap.maxItems <= 12));
  assert.ok(plan.deterministicCaps.some((cap) => cap.name === "worker_packet_optimizer"));
  assert.ok(plan.nextRequiredTool);
  assert.ok(plan.steps.some((step) => step.tinyTool === "legacy_repo_index"));
  assert.ok(plan.steps.some((step) => step.tinyTool === "traceability_matrix"));
  assert.ok(plan.steps.some((step) => step.tinyTool === "evidence_qa"));
  assert.ok(plan.steps.some((step) => step.tinyTool === "qwen_retry_policy"));
  assert.ok(plan.steps.some((step) => step.tinyTool === "mermaid_check"));
  assert.ok(plan.verification.requiredAfterWork);
  assert.ok(plan.verification.requiredTools.includes("task_checkpoint"));
});

test("repo_map summarizes architecture layers and data flow hints", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-repo-map-"));
  await mkdir(path.join(root, "src", "ui"), { recursive: true });
  await mkdir(path.join(root, "src", "api"), { recursive: true });
  await mkdir(path.join(root, "src", "db"), { recursive: true });
  await writeFile(path.join(root, "src", "ui", "CheckoutButton.tsx"), "export function CheckoutButton() { return <button onClick={submitOrder}>Buy</button>; }\n", "utf8");
  await writeFile(path.join(root, "src", "api", "order-controller.ts"), "app.post('/orders', async (req) => saveOrder(req.body));\n", "utf8");
  await writeFile(path.join(root, "src", "db", "order-repository.ts"), "export const saveOrder = (order) => sql`INSERT INTO orders ${order}`;\n", "utf8");
  const plugin = createTinyChuPlugin({ root });
  const map = await plugin.tools.repo_map({ maxFiles: 20 });
  assert.ok(map.files.length <= 20);
  assert.deepEqual(map.layers.map((layer) => layer.name), ["ui", "api", "database"]);
  assert.ok(map.dataFlowHints.some((hint) => hint.from === "ui" && hint.to === "api"));
  assert.ok(map.dataFlowHints.some((hint) => hint.from === "api" && hint.to === "database"));
  assert.ok(map.recommendedCommands.some((command) => command.includes("rg --json")));
  assert.ok(map.recommendedCommands.some((command) => command.includes("ast-grep")));
});

test("repo_map prioritizes an explicit file target", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-repo-map-file-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "a.ts"), "export const ignored = true;\n", "utf8");
  await writeFile(path.join(root, "src", "z-target.ts"), "export function TargetButton() { return <button>Save</button>; }\n", "utf8");
  const plugin = createTinyChuPlugin({ root });
  const map = await plugin.tools.repo_map({ targetPath: "src/z-target.ts", maxFiles: 1 });
  assert.deepEqual(map.files.map((file) => file.path), ["src/z-target.ts"]);
  assert.equal(map.files[0].layer, "ui");
});

test("business_logic_map extracts bounded variables columns and comparisons", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-business-logic-"));
  await mkdir(path.join(root, "src", "domain"), { recursive: true });
  await mkdir(path.join(root, "src", "db"), { recursive: true });
  await writeFile(path.join(root, "src", "domain", "pricing.ts"), [
    "export function canCharge(order, customer) {",
    "  const totalAmount = order.totalAmount;",
    "  return totalAmount >= customer.creditLimit && order.status !== 'cancelled';",
    "}",
  ].join("\n"), "utf8");
  await writeFile(path.join(root, "src", "db", "orders.sql"), [
    "SELECT order_id, customer_id, total_amount",
    "FROM orders",
    "WHERE customer_id = $1 AND total_amount >= 100",
  ].join("\n"), "utf8");
  const plugin = createTinyChuPlugin({ root });
  const map = await plugin.tools.business_logic_map({ targetPath: "src", maxFiles: 10, maxItemsPerFile: 8 });
  assert.ok(map.files.length <= 10);
  assert.ok(map.files.some((file) => file.variables.includes("order.totalAmount")));
  assert.ok(map.files.some((file) => file.columns.includes("customer_id")));
  assert.ok(map.files.some((file) => file.comparisons.some((comparison) => comparison.operator === ">=")));
  assert.ok(map.recommendedCommands.some((command) => command.includes("ast-grep")));
});

test("business_logic_map prioritizes an explicit file target", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-business-file-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "a.ts"), "export const ignored = account.balance >= 0;\n", "utf8");
  await writeFile(path.join(root, "src", "z-target.ts"), "export const approved = order.total_amount >= customer.credit_limit;\n", "utf8");
  const plugin = createTinyChuPlugin({ root });
  const map = await plugin.tools.business_logic_map({ targetPath: "src/z-target.ts", maxFiles: 1, maxItemsPerFile: 8 });
  assert.deepEqual(map.files.map((file) => file.path), ["src/z-target.ts"]);
  assert.ok(map.files[0].columns.includes("total_amount"));
  assert.ok(map.files[0].comparisons.some((comparison) => comparison.left === "order.total_amount" && comparison.operator === ">="));
});

test("business_logic_map ignores jsx tags while preserving real comparisons", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-business-jsx-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "View.tsx"), "export function View(){ return <button disabled={total >= limit}>Pay</button>; }\n", "utf8");
  const plugin = createTinyChuPlugin({ root });
  const map = await plugin.tools.business_logic_map({ targetPath: "src/View.tsx", maxFiles: 1, maxItemsPerFile: 8 });
  const comparisons = map.files[0].comparisons;
  assert.ok(comparisons.some((comparison) => comparison.left === "total" && comparison.operator === ">=" && comparison.right === "limit"));
  assert.ok(!comparisons.some((comparison) => comparison.left === "return" && comparison.operator === "<"));
});

test("qwen_retry_policy encodes public delegate limits and non-stop recovery", async () => {
  const plugin = createTinyChuPlugin();
  const policy = await plugin.tools.qwen_retry_policy({ estimatedTokens: 45000, attempt: 2, status: "rate_limited" });
  assert.equal(policy.model, "qwen3.6-35b-a3b");
  assert.equal(policy.limits.requestsPerMinute, 20);
  assert.equal(policy.limits.tokensPerMinute, 20000);
  assert.equal(policy.neverStop, true);
  assert.equal(policy.shouldRetry, true);
  assert.ok(policy.minimumBatches >= 3);
  assert.ok(policy.retryDelaysMs.every((delay) => delay >= 3000));
});

test("orchestration_health summarizes recoverable queue state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-health-"));
  const plugin = createTinyChuPlugin({ root });
  await plugin.tools.public_dispatch({ prompt: "Analyze checkout flow", mustReturn: ["findings"] });
  const health = await plugin.tools.orchestration_health({});
  assert.equal(health.qwen.limits.requestsPerMinute, 20);
  assert.equal(health.qwen.limits.tokensPerMinute, 20000);
  assert.ok(health.publicJobs.total >= 1);
  assert.ok(health.recoverySteps.some((step) => step.includes("public_retry")));
  assert.ok(health.recoverySteps.some((step) => step.includes("task_checkpoint")));
});

test("orchestration_health treats checkpointed public jobs as attention", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-health-checkpointed-"));
  const plugin = createTinyChuPlugin({ root });
  const job = await plugin.tools.public_dispatch({ prompt: "Analyze checkout flow", mustReturn: ["findings"] });
  await plugin.tools.public_checkpoint({ id: job.id, summary: "partial worker result", result: "half done" });
  const health = await plugin.tools.orchestration_health({});
  assert.equal(health.status, "attention");
  assert.equal(health.publicJobs.retryable, 1);
});

test("rules_snapshot writes architecture rules for future implementations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-rules-"));
  const plugin = createTinyChuPlugin({ root });
  const snapshot = await plugin.tools.rules_snapshot({
    evidenceRefs: ["src/opencode/tiny-plugin.ts", "src/opencode/plugin.ts", "test/small-model-resilience.test.mjs"],
  });
  assert.equal(snapshot.path, ".tiny/rules/architecture-patterns.md");
  assert.ok(snapshot.rules.some((rule) => rule.includes("TinyFeaturePackage")));
  assert.ok(snapshot.rules.some((rule) => rule.includes("generated registry")));
  const markdown = await readFile(path.join(root, ".tiny", "rules", "architecture-patterns.md"), "utf8");
  assert.match(markdown, /OpenCode tool bridge/);
  assert.doesNotMatch(markdown, /TOOL_SPECS/);
  assert.match(markdown, /Evidence refs/);
});
